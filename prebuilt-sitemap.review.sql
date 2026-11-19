-- sexytw.cc only. Persistent pre-generated XML, not a memory cache.
-- No lifecycle/content writes. All source mutations retain their existing RLS.
CREATE SCHEMA sexytw_sitemap;
REVOKE ALL ON SCHEMA sexytw_sitemap FROM PUBLIC;

CREATE FUNCTION sexytw_sitemap.policy_fingerprint() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
 SELECT md5(string_agg(n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||p.polname||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),'|' ORDER BY c.relname,p.polname))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_policy p ON p.polrelid=c.oid
 WHERE n.nspname='public' AND c.relname IN ('profiles','articles','regions','cities','article_categories','site_settings');
$$;
REVOKE ALL ON FUNCTION sexytw_sitemap.policy_fingerprint() FROM PUBLIC;

CREATE TABLE sexytw_sitemap.file (
 site text PRIMARY KEY CHECK(site='sexytw'),
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 revision bigint NOT NULL DEFAULT 0,
 approved_policy text NOT NULL,
 valid boolean NOT NULL DEFAULT false,
 xml text,
 url_count integer NOT NULL DEFAULT 0,
 byte_count integer NOT NULL DEFAULT 0,
 generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT valid OR (xml IS NOT NULL AND url_count BETWEEN 4 AND 50000 AND byte_count BETWEEN 1 AND 52428800))
);
ALTER TABLE sexytw_sitemap.file ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_file_read ON sexytw_sitemap.file FOR SELECT TO anon,authenticated USING(site='sexytw' AND valid);
REVOKE ALL ON sexytw_sitemap.file FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA sexytw_sitemap TO anon,authenticated;
GRANT SELECT ON sexytw_sitemap.file TO anon,authenticated;
GRANT EXECUTE ON FUNCTION sexytw_sitemap.policy_fingerprint() TO anon,authenticated;
DO $$ BEGIN
 IF sexytw_sitemap.policy_fingerprint() IS DISTINCT FROM '3f3203233943354a0ed1d34701da8c9a' THEN RAISE EXCEPTION 'UNREVIEWED_SITEMAP_POLICIES'; END IF;
END $$;
INSERT INTO sexytw_sitemap.file(site,approved_policy) VALUES('sexytw','3f3203233943354a0ed1d34701da8c9a');

CREATE FUNCTION sexytw_sitemap.segment(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=''
AS $$
DECLARE bytes bytea; result text; BEGIN
 IF length(value)=0 OR length(value)>400 OR value IN ('.','..') OR value ~ E'[/\\\\?#\\x01-\\x20]' THEN RAISE EXCEPTION 'INVALID_SITEMAP_SEGMENT'; END IF;
 bytes:=convert_to(value,'UTF8');
 SELECT string_agg(CASE WHEN get_byte(bytes,n) BETWEEN 65 AND 90 OR get_byte(bytes,n) BETWEEN 97 AND 122 OR get_byte(bytes,n) BETWEEN 48 AND 57 OR chr(get_byte(bytes,n)) IN ('-','_','.','!','~','*','''','(',')') THEN chr(get_byte(bytes,n)) ELSE '%'||upper(lpad(to_hex(get_byte(bytes,n)),2,'0')) END,'' ORDER BY n)
 INTO result FROM generate_series(0,length(bytes)-1) n;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION sexytw_sitemap.segment(text) FROM PUBLIC;

-- Definer is confined to a non-exposed schema and cannot be called by API roles.
-- It reads only public URL metadata using the reviewed explicit visibility rules.
-- A policy change fails the public read gate until separately reviewed, never
-- silently re-approving a new policy during an ordinary content update.
CREATE FUNCTION sexytw_sitemap.rebuild() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$
DECLARE body text; total integer; unique_total integer; BEGIN
 PERFORM pg_advisory_xact_lock(735119,4519);
 IF sexytw_sitemap.policy_fingerprint() IS DISTINCT FROM (SELECT approved_policy FROM sexytw_sitemap.file WHERE site='sexytw') THEN RAISE EXCEPTION 'SITEMAP_POLICY_DRIFT'; END IF;
 WITH entries(loc,modified,freq,priority) AS (
  VALUES ('https://sexytw.cc/'::text,NULL::timestamptz,'weekly'::text,'1'::text),
   ('https://sexytw.cc/articles',NULL,'weekly','0.8'),('https://sexytw.cc/privacy',NULL,'yearly','0.2'),('https://sexytw.cc/terms',NULL,'yearly','0.2')
  UNION ALL SELECT 'https://sexytw.cc/profiles/'||sexytw_sitemap.segment(slug),updated_at,'weekly','0.6' FROM public.profiles WHERE status='published' AND adult_review_status='verified' AND source_missing_at IS NULL
  UNION ALL SELECT 'https://sexytw.cc/articles/'||sexytw_sitemap.segment(slug),coalesce(updated_at,published_at),'monthly','0.65' FROM public.articles WHERE status='published'
  UNION ALL SELECT 'https://sexytw.cc/regions/'||sexytw_sitemap.segment(r.slug),NULL,'weekly','0.7' FROM public.regions r WHERE r.published AND EXISTS(SELECT 1 FROM public.cities c WHERE c.region_id=r.id AND c.published)
  UNION ALL SELECT 'https://sexytw.cc/regions/'||sexytw_sitemap.segment(r.slug)||'/'||sexytw_sitemap.segment(c.slug),NULL,'weekly','0.7' FROM public.cities c JOIN public.regions r ON r.id=c.region_id WHERE r.published AND c.published
  UNION ALL SELECT 'https://sexytw.cc/articles/category/'||sexytw_sitemap.segment(slug),NULL,'weekly','0.7' FROM public.article_categories WHERE published
  UNION ALL SELECT 'https://sexytw.cc/services/'||sexytw_sitemap.segment(s.value->>'slug'),NULL,'monthly','0.7' FROM public.site_settings settings CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(settings.value)='array' THEN settings.value ELSE '[]'::jsonb END) s(value) WHERE settings.key='services'
 ) SELECT E'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'||string_agg(xmlelement(name url,xmlelement(name loc,loc),CASE WHEN modified IS NOT NULL THEN xmlelement(name lastmod,to_char(modified AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,xmlelement(name changefreq,freq),xmlelement(name priority,priority))::text,E'\n' ORDER BY loc)||E'\n</urlset>',count(*),count(DISTINCT loc) INTO body,total,unique_total FROM entries;
 IF total<>unique_total OR total>50000 OR body IS NULL OR octet_length(body)>52428800 THEN RAISE EXCEPTION 'INVALID_SITEMAP_FILE'; END IF;
 UPDATE sexytw_sitemap.file SET xml=body,url_count=total,byte_count=octet_length(body),valid=true,revision=revision+1,generated_at=clock_timestamp()
 WHERE site='sexytw' AND (NOT valid OR xml IS DISTINCT FROM body);
EXCEPTION WHEN OTHERS THEN
 -- A bad sitemap entry must NOT prevent a legitimate unpublish/delete.
 -- Discard the old public file instead of keeping stale withdrawn URLs.
 UPDATE sexytw_sitemap.file SET xml=NULL,valid=false,revision=revision+1,url_count=0,byte_count=0,generated_at=clock_timestamp() WHERE site='sexytw';
END $$;
REVOKE ALL ON FUNCTION sexytw_sitemap.rebuild() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sexytw_sitemap.source_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ BEGIN PERFORM pg_advisory_xact_lock(735119,4519); RETURN NULL; END $$;
CREATE FUNCTION sexytw_sitemap.source_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ BEGIN PERFORM sexytw_sitemap.rebuild(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION sexytw_sitemap.source_lock() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION sexytw_sitemap.source_refresh() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['profiles','articles','regions','cities','article_categories','site_settings'] LOOP
  EXECUTE format('CREATE TRIGGER sexytw_sitemap_lock BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION sexytw_sitemap.source_lock()',table_name);
  EXECUTE format('CREATE TRIGGER sexytw_sitemap_refresh AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION sexytw_sitemap.source_refresh()',table_name);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER sexytw_sitemap_lock',table_name);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER sexytw_sitemap_refresh',table_name);
 END LOOP;
END $$;
SELECT sexytw_sitemap.rebuild();

-- One indexed row read for the live safety gate. XML is only read on a cache
-- miss, never regenerated here. No user-supplied SQL/URL/role or content writes.
CREATE FUNCTION public.sexytw_sitemap_file_v1(metadata_only boolean DEFAULT true,expected_revision text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
 SELECT jsonb_build_object('site','sexytw','version',1,'revision',generation::text||'-'||revision::text,'urls',url_count,'bytes',byte_count,'generated_at',generated_at,'xml',CASE WHEN metadata_only THEN NULL ELSE xml END)
 FROM sexytw_sitemap.file
 WHERE site='sexytw' AND valid
 AND (expected_revision IS NULL OR expected_revision=generation::text||'-'||revision::text)
 AND approved_policy=sexytw_sitemap.policy_fingerprint()
 AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('profiles','articles','regions','cities','article_categories','site_settings') AND ((t.tgname='sexytw_sitemap_lock' AND t.tgfoid='sexytw_sitemap.source_lock()'::regprocedure AND t.tgtype=62) OR (t.tgname='sexytw_sitemap_refresh' AND t.tgfoid='sexytw_sitemap.source_refresh()'::regprocedure AND t.tgtype=60)) AND t.tgenabled='A' AND t.tgqual IS NULL AND t.tgnargs=0 AND NOT t.tgisinternal)=12;
$$;
REVOKE ALL ON FUNCTION public.sexytw_sitemap_file_v1(boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sexytw_sitemap_file_v1(boolean,text) TO anon,authenticated;
