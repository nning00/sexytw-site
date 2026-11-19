import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readLiveSitemap,sitemapEntries,sitemapUnavailableResponse} from '../lib/live-sitemap.mjs';
import {isProfileVisibilityPath,applyProfileNoStore} from '../lib/profile-visibility-cache.mjs';
const site='https://sexytw.cc';
const sample=()=>({site:'sexytw',version:1,profiles:[{slug:'source-fixture',updated_at:'2026-11-01T00:00:00Z'}],articles:[{slug:'fixture-guide',updated_at:'2026-11-02T00:00:00Z'}],cities:[{region:'north',slug:'taipei'}],categories:[{slug:'booking'}],services:[{slug:'fixture-service'}]});

test('one fresh GET RPC replaces every pagination and full-content read',async()=>{
 let calls=0,options;
 const client={rpc(name,args,opts){calls++;assert.equal(name,'sexytw_public_sitemap_v1');assert.deepEqual(args,{});assert.deepEqual(opts,{get:true});return{abortSignal(signal){assert(signal instanceof AbortSignal);options=signal;return Promise.resolve({data:sample(),error:null});}}}};
 const rows=await readLiveSitemap(client,site);assert.equal(calls,1);assert(!options.aborted);assert.equal(rows.length,9);
 assert.equal(rows.find(x=>x.url.endsWith('/fixture-guide')).lastModified.toISOString(),'2026-11-02T00:00:00.000Z');
});
test('successive requests immediately omit committed hide/unpublish changes without invalidation',async()=>{
 let snapshot=sample(),calls=0;
 const client={rpc(){calls++;return{abortSignal:async()=>({data:structuredClone(snapshot),error:null})}}};
 assert((await readLiveSitemap(client,site)).some(x=>x.url.endsWith('/source-fixture')));
 snapshot.profiles=[];snapshot.articles=[];snapshot.cities=[];snapshot.categories=[];snapshot.services=[];
 const second=await readLiveSitemap(client,site);assert.equal(second.length,4);assert.equal(calls,2);
 snapshot=sample();assert.equal((await readLiveSitemap(client,site)).length,9);assert.equal(calls,3);
});
test('no PostgREST 1000-row truncation, valid empty catalogue never revives demo rows',()=>{
 const d=sample();d.profiles=Array.from({length:4470},(_,n)=>({slug:'source-'+n,updated_at:null}));assert.equal(sitemapEntries(d,site).length,4478);
 for(const k of ['profiles','articles','cities','categories','services'])d[k]=[];assert.equal(sitemapEntries(d,site).length,4);
});
test('malformed responses, wrong site, duplicates, unsafe slugs and oversized results fail closed',()=>{
 for(const mutate of [d=>delete d.profiles,d=>d.profiles=null,d=>d.site='other',d=>d.version=2,d=>d.profiles.push(d.profiles[0]),d=>d.profiles[0].slug='../admin',d=>d.profiles[0].slug='x?private',d=>d.profiles=Array.from({length:50001},(_,i)=>({slug:'x'+i}))]){const d=sample();mutate(d);assert.throws(()=>sitemapEntries(d,site),/SITEMAP_DATA_UNAVAILABLE/);}
 assert.throws(()=>sitemapEntries(sample(),'https://other.invalid'),/SITEMAP_DATA_UNAVAILABLE/);
 const d=sample();d.profiles[0].slug='合法名字';assert(sitemapEntries(d,site).at(-1).url.endsWith(encodeURIComponent('合法名字')));
});
test('timeouts and upstream errors expose no sensitive error or stale fallback',async()=>{
 for(const value of [{data:null,error:{message:'SECRET_SQL_URL'}},{data:sample(),error:{message:'SECRET_SQL_URL'}}])await assert.rejects(readLiveSitemap({rpc:()=>({abortSignal:async()=>value})},site),e=>e.message==='SITEMAP_DATA_UNAVAILABLE');
 await assert.rejects(readLiveSitemap({rpc(){throw Error('SECRET_SQL_URL')}},site),e=>e.message==='SITEMAP_DATA_UNAVAILABLE');
 for(const method of ['GET','HEAD']){const r=sitemapUnavailableResponse(method);assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'60');for(const h of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control'])assert.match(r.headers.get(h),/no-store/);assert(!((await r.text()).includes('SECRET')));}
});
function compileWorker(handler){
 const code=ts.transpileModule(readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={'vinext/server/fetch-handler':{default:handler},'vinext/shims/fetch-cache':{getOriginalFetch:()=>fetch},'../lib/article-canonical.mjs':{applyArticleCanonical(){}},'../lib/profile-sync-dispatch.mjs':{},'../lib/public-read-scope.mjs':{withPublicReadScope:async f=>({response:await f(),serverTiming:''})},'../lib/profile-visibility-cache.mjs':{isProfileVisibilityPath,applyProfileNoStore},'../lib/live-sitemap.mjs':{sitemapUnavailableResponse},'../lib/prebuilt-sitemap.mjs':{prebuiltSitemapResponse:request=>handler.fetch(request)}};
 const exp={};new Function('exports','require','caches',code)(exp,key=>{assert(key in imports,key);return imports[key]},{open:async()=>({})});return exp.default;
}
test('actual Worker maps sitemap-only failures to no-store 503 and preserves successful XML/other routes',async()=>{
 const err=Error('private error');let handler={fetch:async()=>{throw err}};let worker=compileWorker(handler);
 assert.equal((await worker.fetch(new Request(site+'/sitemap.xml'),{},{})).status,503);
 await assert.rejects(worker.fetch(new Request(site+'/api/health'),{},{}),e=>e===err);
 handler={fetch:async()=>new Response('private html',{status:500})};worker=compileWorker(handler);assert.equal((await worker.fetch(new Request(site+'/sitemap.xml'),{},{})).status,503);assert.equal((await worker.fetch(new Request(site+'/api/health'),{},{})).status,500);
 handler={fetch:async()=>new Response('<urlset/>',{headers:{'Content-Type':'application/xml'}})};worker=compileWorker(handler);
 const ok=await worker.fetch(new Request(site+'/sitemap.xml'),{},{});assert.equal(ok.status,200);assert.equal(await ok.text(),'<urlset/>');assert.match(ok.headers.get('Cache-Control'),/no-store/);
});
test('SQL contract is read-only invoker, explicit visibility and minimal fields; cron untouched',()=>{
 const sql=readFileSync(new URL('../public-sitemap.review.sql',import.meta.url),'utf8');
 assert.match(sql,/STABLE SECURITY INVOKER SET search_path = ''/);assert(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|SECURITY DEFINER)\b/i.test(sql));
 for(const s of ["status='published'","adult_review_status='verified'","source_missing_at IS NULL","r.published AND c.published","settings.key='services'","FROM PUBLIC","TO anon,authenticated"])assert(sql.includes(s));
 for(const s of ['display_name','introduction','content','source_url','auth.users','storage.objects'])assert(!sql.includes(s));
 const source=readFileSync(new URL('../app/sitemap.xml/route.ts',import.meta.url),'utf8');assert(source.includes("dynamic = 'force-dynamic'"));assert(source.includes('prebuiltSitemapResponse'));assert(!source.includes('profileExamples'));assert(!source.includes('getPublishedArticles'));
});
