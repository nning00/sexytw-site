// Isolated GitHub Postgres only; adapter hard-fails all other environments.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createPsqlAdapter,fixtureConfigFromEnvironment} from './ci-postgres.mjs';
const db=createPsqlAdapter(fixtureConfigFromEnvironment());
await db.sql(`
 ALTER TABLE public.profiles ADD COLUMN source_missing_at timestamptz;
 CREATE TABLE public.articles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text,status text,updated_at timestamptz,published_at timestamptz,content text);
 CREATE TABLE public.regions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text,published boolean);
 CREATE TABLE public.cities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),region_id uuid,slug text,published boolean);
 CREATE TABLE public.article_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text,published boolean);
 CREATE TABLE public.site_settings(key text PRIMARY KEY,value jsonb);
 GRANT USAGE ON SCHEMA public TO anon,authenticated;
 GRANT SELECT ON public.profiles,public.articles,public.regions,public.cities,public.article_categories,public.site_settings TO anon,authenticated;
 ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.profiles FOR SELECT TO anon,authenticated USING(status='published' AND adult_review_status='verified' AND source_missing_at IS NULL);
 ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.articles FOR SELECT TO anon,authenticated USING(status='published');
 ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.regions FOR SELECT TO anon,authenticated USING(published);
 ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.cities FOR SELECT TO anon,authenticated USING(published);
 ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.article_categories FOR SELECT TO anon,authenticated USING(published);
 ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sitemap_fixture_public ON public.site_settings FOR SELECT TO anon,authenticated USING(true);
 TRUNCATE public.profiles;
 INSERT INTO public.profiles(id,slug,status,adult_review_status,updated_at) SELECT gen_random_uuid(),'visible-'||n,'published','verified','2026-11-01' FROM generate_series(1,1401) n;
 INSERT INTO public.profiles(id,slug,status,adult_review_status,source_missing_at) VALUES(gen_random_uuid(),'hidden','published','verified',now()),(gen_random_uuid(),'draft','draft','verified',null),(gen_random_uuid(),'pending','published','pending',null),(gen_random_uuid(),'archived','archived','verified',null);
 INSERT INTO public.articles(slug,status,updated_at,content) VALUES('article-public','published','2026-11-02','SECRET_BODY'),('article-draft','draft','2026-11-03','SECRET_BODY');
 INSERT INTO public.regions(slug,published) VALUES('north',true),('hidden-region',false);
 INSERT INTO public.cities(region_id,slug,published) SELECT id,'visible-city',true FROM public.regions WHERE slug='north';
 INSERT INTO public.cities(region_id,slug,published) SELECT id,'hidden-city',false FROM public.regions WHERE slug='north';
 INSERT INTO public.cities(region_id,slug,published) SELECT id,'hidden-parent-city',true FROM public.regions WHERE slug='hidden-region';
 INSERT INTO public.article_categories(slug,published) VALUES('public-category',true),('private-category',false);
 INSERT INTO public.site_settings VALUES('services','[{"slug":"real-service","secret":"SECRET_IMAGE"}]'),('other-private-key','{"value":"SECRET_SETTING"}');
`);
await db.sql(readFileSync(new URL('../public-sitemap.review.sql',import.meta.url),'utf8'));
const fetchSnapshot=async role=>JSON.parse(await db.sql(`SET ROLE ${role}; SELECT public.sexytw_public_sitemap_v1();`));
test('anon/authenticated receive all >1000 live rows but no unpublished/private fields',async()=>{
 for(const role of ['anon','authenticated']){
  const data=await fetchSnapshot(role);assert.equal(data.version,1);assert.equal(data.site,'sexytw');assert.equal(data.profiles.length,1401);
  assert.deepEqual(data.articles.map(x=>x.slug),['article-public']);assert.deepEqual(data.cities,[{region:'north',slug:'visible-city'}]);
  assert.deepEqual(data.categories,[{slug:'public-category'}]);assert.deepEqual(data.services,[{slug:'real-service'}]);
  assert(!JSON.stringify(data).includes('SECRET'));assert(data.profiles.every(x=>Object.keys(x).sort().join(',')==='slug,updated_at'));
 }
});
test('committed hide, unpublish and reappearance visible on next call without cache invalidation',async()=>{
 await db.sql("UPDATE public.profiles SET source_missing_at=now() WHERE slug='visible-1';UPDATE public.articles SET status='draft' WHERE slug='article-public';UPDATE public.cities SET published=false WHERE slug='visible-city';");
 const hidden=await fetchSnapshot('anon');assert.equal(hidden.profiles.length,1400);assert(!hidden.profiles.some(x=>x.slug==='visible-1'));assert.equal(hidden.articles.length,0);assert.equal(hidden.cities.length,0);
 await db.sql("UPDATE public.profiles SET source_missing_at=null WHERE slug='visible-1';");assert.equal((await fetchSnapshot('anon')).profiles.length,1401);
});
test('invoker preserves RLS even beyond explicit filters, PUBLIC cannot execute',async()=>{
 await db.sql("CREATE POLICY sitemap_fixture_deny_one ON public.profiles AS RESTRICTIVE FOR SELECT TO anon USING(slug<>'visible-2');");assert.equal((await fetchSnapshot('anon')).profiles.length,1400);
 assert.equal(await db.sql("SELECT prosecdef::text||','||provolatile::text FROM pg_proc WHERE oid='public.sexytw_public_sitemap_v1()'::regprocedure"),'false,s');
 assert.equal(await db.sql("SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='public.sexytw_public_sitemap_v1()'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'"),'0');
});
