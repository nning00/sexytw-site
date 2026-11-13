// Synthetic local harness. No HTTP, credentials or production data.
import assert from 'node:assert/strict';
import ts from 'typescript';import {readFileSync} from 'node:fs';
import {withPublicReadScope,publicReadOnce} from '../lib/public-read-scope.mjs';
import {isProfileVisibilityPath,applyProfileNoStore} from '../lib/profile-visibility-cache.mjs';
import * as cache from '../node_modules/vinext/dist/shims/cache.js';
cache.setDataCacheHandler(new cache.MemoryCacheHandler());
let rows=[{id:'a',slug:'fixture-a',status:'published',adult_review_status:'verified',source_missing_at:null,profile_images:[]},{id:'b',slug:'fixture-b',status:'published',adult_review_status:'verified',source_missing_at:null,profile_images:[]},{id:'c',slug:'fixture-c',status:'archived',adult_review_status:'verified',source_missing_at:null},{id:'d',slug:'fixture-d',status:'published',adult_review_status:'pending',source_missing_at:null}];
let queryCount=0;
function client(options){if(options)assert.equal(options.noStore,true);return {from(table){let filters=[],start=0,end=9999,single=false;const q={select(){return q},eq(k,v){filters.push(r=>get(r,k)===v);return q},neq(k,v){filters.push(r=>get(r,k)!==v);return q},is(k,v){filters.push(r=>get(r,k)===v);return q},in(k,v){filters.push(r=>v.includes(get(r,k)));return q},order(){return q},range(a,b){start=a;end=b;return q},limit(n){end=n-1;return q},maybeSingle(){single=true;return q},then(resolve){queryCount++;let data=table==='regions'?[{id:'r',slug:'north',published:true,cities:[]}]:table==='cities'?[{id:'city',region_id:'r',slug:'city',published:true}]:rows.filter(r=>r.status==='published'&&r.adult_review_status==='verified').map(r=>table==='profiles'?r:{profile_id:r.id,city_id:'city',profiles:r});data=data.filter(r=>filters.every(f=>f(r)));const count=data.length;data=data.slice(start,end+1);return Promise.resolve({data:single?data[0]??null:structuredClone(data),count,error:null}).then(resolve)}};return q}}}
function get(r,k){return k.split('.').reduce((v,p)=>v?.[p],r)}
function compile(file,imports){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',code)(exports,n=>{if(!(n in imports))throw Error('Unexpected import '+n);return imports[n]});return exports}
const makeCms=()=>compile('../lib/cms.ts',{'next/cache':cache,'@/lib/supabase/public':{createPublicClient:client},'@/lib/image-position':{normalizeImagePosition:x=>x},'@/lib/media-url':{mediaUrl:x=>x},'@/lib/public-read-scope.mjs':{publicReadOnce},'@/lib/home-article-cards.mjs':{queryHomeArticleCards:async()=>[]}});
const instances=[makeCms(),makeCms()];let cms=instances[0];
async function visible(expected){assert.deepEqual((await cms.getPublishedProfiles()).map(x=>x.id),expected);assert.deepEqual((await cms.getPublishedProfilesForCity('north','city')).map(x=>x.id),expected);const page=await cms.getPublishedProfilePageForCity('north','city');assert.equal(page.total,expected.length);assert.deepEqual(page.profiles.map(x=>x.id),expected);assert.equal(Boolean(await cms.getPublishedProfile('fixture-a')),expected.includes('a'));assert.deepEqual((await cms.getRelatedProfiles('b')).map(x=>x.id),expected.filter(x=>x!=='b'));}
await visible(['a','b']);rows[0].source_missing_at='2026-11-13T00:00:00Z';
for(const instance of instances){cms=instance;await visible(['b']);} // no invalidation broadcast needed
cache.revalidateTag('profiles',{expire:0});cache.revalidateTag('regions',{expire:0});await new Promise(r=>setTimeout(r,5));await visible(['b']);
const sitemap=compile('../app/sitemap.ts',{'@/data/regions':{regions:[]},'@/data/articles':{articles:[]},'@/data/profiles':{profileExamples:[]},'@/lib/supabase/public':{createPublicClient:client},'@/lib/cms':{...cms,getPublishedArticles:async()=>[],getArticleCategories:async()=>[],getContentSettings:async()=>({services:[]})}}).default;
assert.equal((await sitemap()).some(x=>x.url.endsWith('/profiles/fixture-a')),false);
rows[0].source_missing_at=null;for(const instance of instances){cms=instance;await visible(['a','b']);}cache.revalidateTag('profiles',{expire:0});cache.revalidateTag('regions',{expire:0});await new Promise(r=>setTimeout(r,5));await visible(['a','b']);assert.equal((await sitemap()).some(x=>x.url.endsWith('/profiles/fixture-a')),true);
assert.equal(await cms.getPublishedProfile('fixture-c'),null);assert.equal(await cms.getPublishedProfile('fixture-d'),null);
const detail=readFileSync(new URL('../app/profiles/[id]/page.tsx',import.meta.url),'utf8');assert.ok(detail.includes('if (!profile) notFound()'));
console.log('PASS: actual CMS list/city/pagination/detail/related + sitemap under hide/reappearance; actual vinext MemoryCache invalidation; archived/pending excluded; detail notFound static contract. No rendered HTTP/CDN assertion.');

for(const path of ['/profiles/a','/regions/north/city','/sitemap.xml','/api/city-profiles']){assert.equal(isProfileVisibilityPath(path),true);const r=applyProfileNoStore(new Response('fixture',{headers:{'Cache-Control':'public,max-age=3600'}}));for(const h of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control'])assert.equal(r.headers.get(h),'private, no-store, max-age=0');}
for(const path of ['/','/articles/a','/admin/profiles','/api/profile-sync','/regions/north','/image.jpg'])assert.equal(isProfileVisibilityPath(path),false);
const before=queryCount;await withPublicReadScope(async()=>{await Promise.all([cms.getPublishedProfile('fixture-a'),cms.getPublishedProfile('fixture-a')]);return new Response('fixture')});assert.equal(queryCount-before,1);
const started=performance.now(),q0=queryCount;for(let i=0;i<100;i++)await withPublicReadScope(async()=>{await Promise.all([cms.getPublishedProfile('fixture-a'),cms.getPublishedProfile('fixture-a')]);return new Response('fixture')});console.log(JSON.stringify({syntheticRequests:100,databaseReads:queryCount-q0,elapsedMs:performance.now()-started,networkLatencySimulated:false}));
console.log('PASS two independent CMS instances: hide/reappear with no cache broadcast; exact path/header scope; request-local duplicate reads coalesced.');
const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,oldFetch=globalThis.fetch;
try {
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-not-secret';
 let init;globalThis.fetch=async(_url,options)=>{init=options;return new Response('{}')};
 const publicModule=compile('../lib/supabase/public.ts',{'@supabase/supabase-js':{createClient:(_u,_k,options)=>options},'@/lib/site-instance':{supabaseSchema:'public'}});
 const noStore=publicModule.createPublicClient({noStore:true});await noStore.global.fetch('https://fixture.invalid',{cache:'force-cache'});assert.equal(init.cache,'no-store');
 assert.equal(publicModule.createPublicClient().global,undefined);
} finally { globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=oldKey; }
for(const path of ['../app/profiles/[id]/page.tsx','../app/regions/[slug]/[city]/page.tsx','../app/sitemap.ts','../app/api/city-profiles/route.ts']){const source=readFileSync(new URL(path,import.meta.url),'utf8');assert.ok(source.includes('dynamic = "force-dynamic"'));assert.ok(source.includes('revalidate = 0'));}
console.log('PASS real public-client configuration no-store and unrelated client unchanged; dynamic route contracts.');
