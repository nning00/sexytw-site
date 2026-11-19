-- sexytw only; no publication, deletion, auth or RLS policy changes.
CREATE OR REPLACE FUNCTION public.sexytw_repair_incomplete_draft(
 p_id uuid,p_marker text,p_expected_updated_at timestamptz,p_source_url text,p_city_id uuid,p_images jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.profiles%ROWTYPE; x jsonb; n integer; i integer := 0;
BEGIN
 IF p_source_url IS NULL OR p_expected_updated_at IS NULL OR p_marker IS NULL OR p_marker !~ '^create-only:[0-9a-f-]{36}$'
 OR p_images IS NULL OR jsonb_typeof(p_images)<>'array' THEN RAISE EXCEPTION 'Invalid repair proof'; END IF;
 n:=jsonb_array_length(p_images);
 IF n NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid repair images'; END IF;
 LOCK TABLE public.profile_images,public.profile_source_images,public.profile_cities IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO r FROM public.profiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.source_provider IS DISTINCT FROM 'edc-public-catalog' OR r.status IS DISTINCT FROM 'draft'
 OR r.source_content_hash IS DISTINCT FROM p_marker OR r.updated_at IS DISTINCT FROM p_expected_updated_at
 OR r.updated_at IS DISTINCT FROM r.created_at OR r.card_image_path IS NOT NULL
 OR r.source_url IS DISTINCT FROM p_source_url OR p_source_url !~ '^https://edc\.com\.tw/'
 OR EXISTS(SELECT 1 FROM public.profile_images WHERE profile_id=p_id)
 OR EXISTS(SELECT 1 FROM public.profile_source_images WHERE profile_id=p_id)
 OR (SELECT count(*) FROM public.profile_cities WHERE profile_id=p_id)<>1
 OR NOT EXISTS(SELECT 1 FROM public.profile_cities WHERE profile_id=p_id AND city_id=p_city_id)
 THEN RAISE EXCEPTION 'Draft changed or not repairable'; END IF;
 IF (SELECT count(DISTINCT value->>'storage_path') FROM jsonb_array_elements(p_images))<>n
 OR (SELECT count(DISTINCT value->>'source_url') FROM jsonb_array_elements(p_images))<>n THEN RAISE EXCEPTION 'Duplicate proof'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_images) LOOP
  i:=i+1;
  IF x->>'storage_path' IS NULL OR x->>'source_url' IS NULL OR x->>'alt_text' IS NULL
  OR (x->>'sort_order')::int IS DISTINCT FROM i
  OR x->>'storage_path' !~ ('^sexytw/profiles/synced/'||p_id::text||'/repair-[0-9a-f-]{36}/[0-9a-f]{24}\.(jpg|png|webp|avif)$')
  OR x->>'source_url' !~ '^https://(www\.)?edc\.com\.tw/'
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='site-media' AND name=x->>'storage_path')
  THEN RAISE EXCEPTION 'Unsafe or missing repair object'; END IF;
 END LOOP;
 INSERT INTO public.profile_source_images(profile_id,source_url,storage_path,alt_text,sort_order)
 SELECT p_id,value->>'source_url',value->>'storage_path',value->>'alt_text',(value->>'sort_order')::int FROM jsonb_array_elements(p_images);
 INSERT INTO public.profile_images(profile_id,storage_path,alt_text,sort_order)
 SELECT p_id,value->>'storage_path',value->>'alt_text',(value->>'sort_order')::int FROM jsonb_array_elements(p_images);
 UPDATE public.profiles SET card_image_path=p_images->0->>'storage_path',
  source_content_hash='repaired-draft:'||substring(p_marker FROM 13) WHERE id=p_id;
 RETURN jsonb_build_object('ok',true,'status','draft','images',n);
END $$;
REVOKE ALL ON FUNCTION public.sexytw_repair_incomplete_draft(uuid,text,timestamptz,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_repair_incomplete_draft(uuid,text,timestamptz,text,uuid,jsonb) TO service_role;
