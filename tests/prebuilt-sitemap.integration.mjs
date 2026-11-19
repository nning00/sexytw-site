// Synthetic isolated GitHub Postgres only. Never run against production.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createPsqlAdapter,fixtureConfigFromEnvironment} from './ci-postgres.mjs';
const db=createPsqlAdapter(fixtureConfigFromEnvironment());
await db.sql(`
 DROP POLICY sitemap_fixture_deny_one ON public.profiles;
 TRUNCATE public.profiles,public.articles,public.cities,public.regions,public.article_categories,public.site_settings;
 INSERT INTO public.profiles(id,slug,status,adult_review_status,updated_at) SELECT gen_random_uuid(),'visible-'||n,'published','verified','2026-11-01' FROM generate_series(1,1401) n;
 INSERT INTO public.profiles(id,slug,status,adult_review_status,source_missing_at) VALUES(gen_random_uuid(),'hidden-missing','published','verified',now()),(gen_random_uuid(),'hidden-draft','draft','verified',null),(gen_random_uuid(),'hidden-pending','published','pending',null),(gen_random_uuid(),'hidden-archived','archived','verified',null);
 INSERT INTO public.articles(slug,status,updated_at,content) VALUES('article-public','published','2026-11-02','SECRET_BODY'),('article-draft','draft','2026-11-03','SECRET_BODY');
 INSERT INTO public.regions(slug,published) VALUES('north',true),('central',true),('south',true),('east-islands',true),('hidden-region',false),('empty-region',true);
 INSERT INTO public.cities(region_id,slug,published) SELECT id,'city-'||slug,true FROM public.regions WHERE slug<>'empty-region';
 INSERT INTO public.article_categories(slug,published) VALUES('public-category',true),('private-category',false);
 INSERT INTO public.site_settings VALUES('services','[{"slug":"real-service","secret":"SECRET_IMAGE"}]'),('private','{"value":"SECRET_SETTING"}');
`);
const ddl=readFileSync(new URL('../prebuilt-sitemap.review.sql',import.meta.url),'utf8');
const fingerprintQuery=ddl.match(/AS \$\$\n (SELECT md5\([\s\S]+?);\n\$\$;/)[1];
// Fixture roles have different OIDs. Substitute only the reviewed policy digest,
// never remove the initial policy assertion or policy/trigger-drift read gates.
const fixtureFingerprint=await db.sql("SET search_path='';"+fingerprintQuery);
assert.match(fixtureFingerprint,/^[a-f0-9]{32}$/);
await db.sql(ddl.replaceAll('ab86a6a880983d34b2d79a013c93b55a',fixtureFingerprint));
const file=async(role='anon')=>JSON.parse(await db.sql(`SET ROLE ${role};SELECT public.sexytw_sitemap_file_v1(false);`));
const meta=async()=>JSON.parse(await db.sql('SET ROLE anon;SELECT public.sexytw_sitemap_file_v1();'));
test('persisted XML contains every public profile, all four regions and no private fields/status',async()=>{
 for(const role of ['anon','authenticated']){const data=await file(role);assert(data);assert.equal(data.urls,1416);assert.equal((data.xml.match(/<url>/g)||[]).length,1416);assert.equal(data.bytes,Buffer.byteLength(data.xml));assert(!data.xml.includes('SECRET'));assert(!data.xml.includes('hidden-'));assert(!data.xml.includes('article-draft'));assert(!data.xml.includes('/regions/empty-region<'));for(const slug of ['north','central','south','east-islands'])assert(data.xml.includes('<loc>https://sexytw.cc/regions/'+slug+'</loc>'));}
 const m=await meta();assert.equal(m.xml,null);assert.equal(m.urls,1416);
});
test('committed unpublish/missing/adult revoke/delete remove immediately, reappearance restores',async()=>{
 const before=await meta();
 await db.sql("UPDATE public.profiles SET status='draft' WHERE slug='visible-1';UPDATE public.profiles SET source_missing_at=now() WHERE slug='visible-2';UPDATE public.profiles SET adult_review_status='pending' WHERE slug='visible-3';DELETE FROM public.profiles WHERE slug='visible-4';UPDATE public.articles SET status='draft' WHERE slug='article-public';");
 const after=await file();assert.notEqual(after.revision,before.revision);for(const slug of ['visible-1','visible-2','visible-3','visible-4'])assert(!after.xml.includes('/profiles/'+slug+'</loc>'));assert.equal(after.urls,1411);
 assert.equal(JSON.parse(await db.sql(`SET ROLE anon;SELECT public.sexytw_sitemap_file_v1(false,'${before.revision}');`)),null);
 await db.sql("UPDATE public.profiles SET source_missing_at=null WHERE slug='visible-2';");assert((await file()).xml.includes('/profiles/visible-2</loc>'));
});
test('parent/last-city withdrawal removes overview and affected cities in the same transaction',async()=>{
 await db.sql("UPDATE public.regions SET published=false WHERE slug='north';UPDATE public.cities SET published=false WHERE slug='city-central';");const data=await file();assert(!data.xml.includes('/regions/north'));assert(!data.xml.includes('/regions/central'));assert(data.xml.includes('/regions/south</loc>'));
});
test('same data writes do not write another file/revision; rollback leaves file unchanged',async()=>{
 const before=await meta();await db.sql("UPDATE public.profiles SET source_key=source_key WHERE slug='visible-5';");assert.equal((await meta()).revision,before.revision);
 await db.sql("BEGIN;UPDATE public.profiles SET status='draft' WHERE slug='visible-5';ROLLBACK;");assert.equal((await meta()).revision,before.revision);
});
test('bad metadata invalidates file but does not block legitimate source withdrawal',async()=>{
 await db.sql("UPDATE public.site_settings SET value='[{\"slug\":\"../bad\"}]' WHERE key='services';UPDATE public.profiles SET status='draft' WHERE slug='visible-6';");assert.equal(await meta(),null);assert.equal(await db.sql("SELECT status FROM public.profiles WHERE slug='visible-6'"),'draft');
 await db.sql("UPDATE public.site_settings SET value='[{\"slug\":\"real-service\"}]' WHERE key='services';");const data=await file();assert(!data.xml.includes('visible-6</loc>'));
});
test('unsafe/missing/duplicate slugs fail closed; Unicode and percent are safely encoded',async()=>{
 for(const slug of ['bad/path','..','bad?x','bad x']){await db.sql(`UPDATE public.site_settings SET value='[{"slug":"${slug}"}]' WHERE key='services';`);assert.equal(await meta(),null);}
 await db.sql("UPDATE public.site_settings SET value='[{\"slug\":\"a\"},{\"slug\":\"a\"}]' WHERE key='services';");assert.equal(await meta(),null);
 await db.sql("UPDATE public.site_settings SET value='[{\"slug\":\"臺北%\"}]' WHERE key='services';");assert((await file()).xml.includes('/services/%E8%87%BA%E5%8C%97%25</loc>'));
 await db.sql("UPDATE public.site_settings SET value='[{\"slug\":\"real-service\"}]' WHERE key='services';");
});
test('two concurrent source writers cannot lose committed withdrawals',async()=>{
 const session=db.openTestSession();const done=new Promise((resolve,reject)=>{session.once('error',reject);session.once('close',c=>c===0?resolve():reject(Error('fixture transaction failed')))});
 await new Promise((resolve,reject)=>{session.once('error',reject);session.stdout.on('data',d=>{if(d.toString().includes('FIRST_READY'))resolve()});session.stdin.write("UPDATE public.profiles SET status='draft' WHERE slug='visible-7';SELECT 'FIRST_READY';\n");});
 const second=db.sql("UPDATE public.profiles SET status='draft' WHERE slug='visible-8';");await new Promise(resolve=>setTimeout(resolve,100));session.stdin.end('COMMIT;\n');await Promise.all([done,second]);const data=await file();for(const slug of ['visible-7','visible-8'])assert(!data.xml.includes('/profiles/'+slug+'</loc>'));
});
test('ordinary API roles cannot mutate snapshot, invoke builder/locks or read invalid file',async()=>{
 for(const role of ['anon','authenticated'])for(const statement of ["UPDATE sexytw_sitemap.file SET revision=0",'SELECT sexytw_sitemap.rebuild()','SELECT sexytw_sitemap.source_lock()','TRUNCATE sexytw_sitemap.file'])await assert.rejects(db.sql(`SET ROLE ${role};${statement}`),/permission denied/);
 assert.equal(await db.sql("SELECT prosecdef::text FROM pg_proc WHERE oid='public.sexytw_sitemap_file_v1(boolean,text)'::regprocedure"),'false');
 assert.equal(await db.sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname='sexytw_sitemap' AND p.prosecdef AND a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'),(SELECT oid FROM pg_roles WHERE rolname='authenticated')) AND a.privilege_type='EXECUTE'"),'0');
});
test('policy drift fails closed immediately, including after ordinary content refresh',async()=>{
 await db.sql("CREATE POLICY sitemap_drift ON public.profiles AS RESTRICTIVE FOR SELECT TO anon USING(slug<>'visible-9');");assert.equal(await meta(),null);
 await db.sql("UPDATE public.profiles SET updated_at=now() WHERE slug='visible-10';");assert.equal(await meta(),null);
 await db.sql('DROP POLICY sitemap_drift ON public.profiles;UPDATE public.profiles SET source_key=source_key WHERE false;');assert(await meta());
});
test('disabled or missing invalidation triggers cannot serve a stale persisted file',async()=>{
 await db.sql('ALTER TABLE public.profiles DISABLE TRIGGER sexytw_sitemap_refresh;');assert.equal(await meta(),null);
 await db.sql('ALTER TABLE public.profiles ENABLE ALWAYS TRIGGER sexytw_sitemap_refresh;');assert(await meta());
});
test('bulk source touch preserves XML when URL metadata unchanged (bounded write overhead)',async()=>{
 const before=await meta();const started=performance.now();await db.sql("UPDATE public.profiles SET source_key=source_key WHERE slug LIKE 'visible-%';");assert.equal((await meta()).revision,before.revision);console.log('Synthetic 1401-row bulk touch + trigger ms:',Math.round(performance.now()-started));
});
