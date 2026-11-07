-- Install ONLY in sexytw.cc / lsxrpubpbnshlqnnddgu. No cross-project calls.
-- No profile rows or objects are deleted by installing this script.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sexytw_media_cleanup_queue (
  storage_path text PRIMARY KEY CHECK (storage_path LIKE 'sexytw/%' AND storage_path !~ '(^|/)\.\.?(/|$)' AND storage_path !~* '%(2e|2f|5c)' AND strpos(storage_path, chr(92)) = 0),
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sexytw_media_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sexytw_media_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.sexytw_media_cleanup_queue TO service_role;

CREATE OR REPLACE FUNCTION public.sexytw_owned_media_path(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN value LIKE 'sexytw/%' THEN value
    WHEN value LIKE 'https://lsxrpubpbnshlqnnddgu.supabase.co/storage/v1/object/public/site-media/sexytw/%'
      THEN split_part(substr(value, length('https://lsxrpubpbnshlqnnddgu.supabase.co/storage/v1/object/public/site-media/') + 1), '?', 1)
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.sexytw_profile_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (to_jsonb(NEW) - 'source_last_seen_at' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'source_last_seen_at' - 'updated_at') THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$$;
-- Replace only this project's profiles trigger, not the shared trigger function.
DROP TRIGGER IF EXISTS updated_at ON public.profiles;
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sexytw_profile_updated_at();

CREATE OR REPLACE FUNCTION public.sexytw_finalize_profile_batch(
  p_seen_keys text[], p_captured_at timestamptz, p_after_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  page_ids uuid[];
  missing_ids uuid[];
  final_id uuid;
  scanned integer;
  deleted integer := 0;
  touched integer := 0;
  existing_count integer;
BEGIN
  IF p_captured_at IS NULL OR p_captured_at < now() - interval '8 hours'
    OR p_captured_at > now() + interval '5 minutes'
    OR cardinality(p_seen_keys) IS NULL OR cardinality(p_seen_keys) NOT BETWEEN 1 AND 50000
    OR EXISTS (SELECT 1 FROM unnest(p_seen_keys) k WHERE k IS NULL OR k !~ '^[0-9]{1,80}$')
    OR cardinality(p_seen_keys) <> (SELECT count(DISTINCT k) FROM unnest(p_seen_keys) k) THEN
    RAISE EXCEPTION 'Invalid or stale source snapshot';
  END IF;
  IF p_after_id IS NULL THEN
    SELECT count(*) INTO existing_count FROM public.profiles WHERE source_provider = 'edc-public-catalog';
    IF cardinality(p_seen_keys) < existing_count * 0.2 THEN
      RAISE EXCEPTION 'Unexpected source collapse; cleanup refused';
    END IF;
    -- One set-based presence write, not one biography/SEO rewrite per person.
    UPDATE public.profiles p SET source_last_seen_at = p_captured_at
    WHERE p.source_provider = 'edc-public-catalog'
      AND p.source_key IN (SELECT unnest(p_seen_keys))
      AND (p.source_last_seen_at IS NULL OR p.source_last_seen_at < p_captured_at);
    GET DIAGNOSTICS touched = ROW_COUNT;
  END IF;
  -- Keyset pagination is stable while previous pages are physically deleted.
  SELECT array_agg(id ORDER BY id), count(*), max(id::text)::uuid
    INTO page_ids, scanned, final_id
  FROM (SELECT id FROM public.profiles
    WHERE source_provider = 'edc-public-catalog' AND (p_after_id IS NULL OR id > p_after_id)
    ORDER BY id LIMIT 100) page;
  SELECT array_agg(p.id) INTO missing_ids FROM public.profiles p
  WHERE p.id = ANY(page_ids) AND p.source_provider = 'edc-public-catalog'
    AND NOT EXISTS (SELECT 1 FROM unnest(p_seen_keys) k WHERE k = p.source_key)
    AND p.source_url LIKE 'https://edc.com.tw/%'
    AND (p.source_last_seen_at IS NULL OR p.source_last_seen_at <= p_captured_at)
    AND p.updated_at < p_captured_at;
  IF cardinality(missing_ids) > 0 THEN
    -- Queue media references before cascading deletes, in the SAME transaction.
    -- The queue contains paths only, not archived person/content copies.
    INSERT INTO public.sexytw_media_cleanup_queue(storage_path)
      SELECT DISTINCT path FROM (
        SELECT public.sexytw_owned_media_path(card_image_path) AS path FROM public.profiles WHERE id = ANY(missing_ids)
        UNION SELECT public.sexytw_owned_media_path(storage_path) FROM public.profile_images WHERE profile_id = ANY(missing_ids)
        UNION SELECT public.sexytw_owned_media_path(storage_path) FROM public.profile_source_images WHERE profile_id = ANY(missing_ids)
      ) paths WHERE path IS NOT NULL AND path !~ '(^|/)\.\.?(/|$)'
      ON CONFLICT DO NOTHING;
    DELETE FROM public.profiles WHERE id = ANY(missing_ids) AND source_provider = 'edc-public-catalog';
    GET DIAGNOSTICS deleted = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('scanned', scanned, 'deleted', deleted, 'seenTouched', touched,
    'nextCursor', coalesce(final_id, p_after_id), 'scanComplete', scanned < 100);
END
$$;

CREATE OR REPLACE FUNCTION public.sexytw_media_cleanup_batch()
RETURNS TABLE(storage_path text, can_delete boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH queue AS (
    SELECT q.storage_path FROM public.sexytw_media_cleanup_queue q ORDER BY q.queued_at, q.storage_path LIMIT 100
  ), refs AS (
    SELECT public.sexytw_owned_media_path(card_image_path) AS path FROM public.profiles
    UNION SELECT public.sexytw_owned_media_path(storage_path) FROM public.profile_images
    UNION SELECT public.sexytw_owned_media_path(storage_path) FROM public.profile_source_images
    UNION SELECT public.sexytw_owned_media_path(cover_image_path) FROM public.articles
    UNION SELECT public.sexytw_owned_media_path(storage_path) FROM public.article_images
    UNION SELECT public.sexytw_owned_media_path(image_path) FROM public.regions
  )
  SELECT q.storage_path,
    NOT EXISTS (SELECT 1 FROM refs r WHERE r.path = q.storage_path)
    AND NOT EXISTS (SELECT 1 FROM public.site_settings s WHERE strpos(s.value::text, q.storage_path) > 0)
  FROM queue q
$$;

-- Invoker functions still need explicit EXECUTE restrictions in exposed schema.
REVOKE ALL ON FUNCTION public.sexytw_owned_media_path(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sexytw_profile_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sexytw_finalize_profile_batch(text[],timestamptz,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sexytw_media_cleanup_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_owned_media_path(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sexytw_finalize_profile_batch(text[],timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sexytw_media_cleanup_batch() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
