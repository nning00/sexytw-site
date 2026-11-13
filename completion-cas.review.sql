-- ISOLATED CANDIDATE ONLY. Never apply to production without independent review.
-- Uses an unguessable marker in source_content_hash for this request's new draft.
CREATE OR REPLACE FUNCTION public.sexytw_complete_new_profile(
  p_id uuid, p_marker text, p_expected_updated_at timestamptz,
  p_city_id uuid, p_images jsonb, p_content_hash text, p_cover_path text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.profiles%ROWTYPE; got_images jsonb; got_sources jsonb; expected_images jsonb; expected_sources jsonb;
BEGIN
  IF p_marker !~ '^create-only:[0-9a-f-]{36}$' OR jsonb_typeof(p_images)<>'array'
     OR jsonb_array_length(p_images)=0 OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid new-profile completion proof';
  END IF;
  -- Child-table edits do not advance profiles.updated_at in the existing schema.
  -- Short relation locks prevent a child mutation between comparison and publication.
  LOCK TABLE public.profile_images, public.profile_source_images, public.profile_cities IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO r FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.source_provider<>'edc-public-catalog' OR r.status<>'draft'
    OR r.source_content_hash IS DISTINCT FROM p_marker
    OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'New-profile ownership/version changed; leave draft';
  END IF;
  IF (SELECT count(*) FROM public.profile_cities WHERE profile_id=p_id)<>1
     OR NOT EXISTS(SELECT 1 FROM public.profile_cities WHERE profile_id=p_id AND city_id=p_city_id) THEN
    RAISE EXCEPTION 'City assignments changed; leave draft';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('storage_path',storage_path,'alt_text',alt_text,'sort_order',sort_order) ORDER BY storage_path)
    INTO got_images FROM public.profile_images WHERE profile_id=p_id;
  SELECT jsonb_agg(jsonb_build_object('storage_path',storage_path,'source_url',source_url,'alt_text',alt_text,'sort_order',sort_order) ORDER BY storage_path)
    INTO got_sources FROM public.profile_source_images WHERE profile_id=p_id;
  SELECT jsonb_agg(jsonb_build_object('storage_path',x->>'storage_path','alt_text',x->>'alt_text','sort_order',(x->>'sort_order')::int) ORDER BY x->>'storage_path'),
    jsonb_agg(jsonb_build_object('storage_path',x->>'storage_path','source_url',x->>'source_url','alt_text',x->>'alt_text','sort_order',(x->>'sort_order')::int) ORDER BY x->>'storage_path')
    INTO expected_images,expected_sources FROM jsonb_array_elements(p_images) x;
  IF got_images IS DISTINCT FROM expected_images OR got_sources IS DISTINCT FROM expected_sources
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_images) x WHERE x->>'storage_path'=p_cover_path) THEN
    RAISE EXCEPTION 'Image proof changed; leave draft';
  END IF;
  UPDATE public.profiles SET source_content_hash=p_content_hash,card_image_path=p_cover_path,
    status=CASE WHEN adult_review_status='verified' THEN 'published' ELSE 'draft' END
    WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'published',r.adult_review_status='verified');
END $$;
REVOKE ALL ON FUNCTION public.sexytw_complete_new_profile(uuid,text,timestamptz,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_complete_new_profile(uuid,text,timestamptz,uuid,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sexytw_create_only_capability()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN to_regprocedure('public.sexytw_complete_new_profile(uuid,text,timestamp with time zone,uuid,jsonb,text,text)') IS NOT NULL THEN 1 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.sexytw_create_only_capability() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_create_only_capability() TO service_role;
