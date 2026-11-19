-- sexytw.cc only. One live statement snapshot, not a cache or lifecycle write.
CREATE FUNCTION public.sexytw_public_sitemap_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
 SELECT jsonb_build_object(
  'version',1,'site','sexytw',
  'profiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',p.slug,'updated_at',p.updated_at) ORDER BY p.slug)
    FROM (SELECT slug,updated_at FROM public.profiles
      WHERE status='published' AND adult_review_status='verified' AND source_missing_at IS NULL
      ORDER BY slug LIMIT 50001) p),'[]'::jsonb),
  'articles',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',a.slug,'updated_at',COALESCE(a.updated_at,a.published_at)) ORDER BY a.slug)
    FROM (SELECT slug,updated_at,published_at FROM public.articles WHERE status='published' ORDER BY slug LIMIT 50001) a),'[]'::jsonb),
  'cities',COALESCE((SELECT jsonb_agg(jsonb_build_object('region',c.region_slug,'slug',c.slug) ORDER BY c.region_slug,c.slug)
    FROM (SELECT r.slug AS region_slug,c.slug FROM public.cities c JOIN public.regions r ON r.id=c.region_id
      WHERE r.published AND c.published ORDER BY r.slug,c.slug LIMIT 50001) c),'[]'::jsonb),
  'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',a.slug) ORDER BY a.slug)
    FROM (SELECT slug FROM public.article_categories WHERE published ORDER BY slug LIMIT 50001) a),'[]'::jsonb),
  'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',s.value->>'slug') ORDER BY s.ordinality)
    FROM public.site_settings settings
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(settings.value)='array' THEN settings.value ELSE '[]'::jsonb END) WITH ORDINALITY s(value,ordinality)
    WHERE settings.key='services'),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public.sexytw_public_sitemap_v1() FROM PUBLIC;
-- Only already-public URL metadata, under the caller's existing RLS policies.
GRANT EXECUTE ON FUNCTION public.sexytw_public_sitemap_v1() TO anon,authenticated;
