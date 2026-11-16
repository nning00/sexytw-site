-- REVIEW CANDIDATE ONLY. Never apply to production as part of local validation.
-- Additive new-attempt lane. Disabled by default; no Storage implementation here.
-- Requires the existing profiles/cities/image tables and presence-v3 schema.
BEGIN;
CREATE TABLE public.sexytw_resume_config_v2 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 immutable_proof_provider text, immutable_proof_version integer NOT NULL DEFAULT 0
);
INSERT INTO public.sexytw_resume_config_v2(singleton) VALUES(true);
CREATE TABLE public.sexytw_resume_operations_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, source_key text NOT NULL,
 -- No reverse foreign keys: this additive ledger must not block existing
 -- authorized parent/city deletion. Missing originals fail CAS, never recreate.
 profile_id uuid UNIQUE NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'), city_id uuid NOT NULL,
 original_capture timestamptz NOT NULL, latest_capture timestamptz NOT NULL, intent jsonb NOT NULL,
 expected_profile jsonb NOT NULL, mutation_revision bigint NOT NULL DEFAULT 0, expected_revision bigint NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'open' CHECK(state IN('open','done')), lease_token uuid, lease_until timestamptz,
 epoch bigint NOT NULL DEFAULT 0, image_plans jsonb NOT NULL DEFAULT '[]', object_proofs jsonb NOT NULL DEFAULT '[]',
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(provider,source_key)
);
ALTER TABLE public.sexytw_resume_config_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sexytw_resume_operations_v2 ENABLE ROW LEVEL SECURITY;
-- Remove broad default-privilege grants before adding narrow access.
REVOKE ALL ON public.sexytw_resume_config_v2,public.sexytw_resume_operations_v2 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sexytw_resume_config_v2 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.sexytw_resume_operations_v2 TO service_role;
CREATE POLICY service_read ON public.sexytw_resume_config_v2 TO service_role USING(true);
CREATE POLICY service_access ON public.sexytw_resume_operations_v2 TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.sexytw_resume_capability_v2() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('version',2,'enabled',enabled AND immutable_proof_version=1 AND immutable_proof_provider IS NOT NULL,
  'immutableProofVersion',immutable_proof_version,'immutableProofProvider',immutable_proof_provider)
 FROM public.sexytw_resume_config_v2 WHERE singleton
$$;
CREATE FUNCTION public.sexytw_resume_require_enabled_v2() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sexytw_resume_config_v2 WHERE enabled AND immutable_proof_version=1 AND immutable_proof_provider IS NOT NULL)
 THEN RAISE EXCEPTION 'resume-capability-disabled'; END IF;
END $$;
CREATE FUNCTION public.sexytw_resume_touch_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN('profiles','profile_cities','profile_images','profile_source_images')
 THEN RAISE EXCEPTION 'resume-invalid-trigger-target'; END IF;
 IF TG_OP<>'INSERT' THEN IF TG_TABLE_NAME='profiles' THEN old_id:=OLD.id; ELSE old_id:=OLD.profile_id; END IF; END IF;
 IF TG_OP<>'DELETE' THEN IF TG_TABLE_NAME='profiles' THEN new_id:=NEW.id; ELSE new_id:=NEW.profile_id; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sexytw_resume_operations_v2 WHERE state='open' AND profile_id IN(old_id,new_id)) THEN RETURN NULL; END IF;
 -- Must still track open operations if capability is later disabled.
 UPDATE public.sexytw_resume_operations_v2 SET mutation_revision=mutation_revision+1 WHERE state='open' AND profile_id IN(old_id,new_id);
 RETURN NULL;
END $$;
-- Track every mutation, including ABA and presence fields deliberately excluded
-- from the existing profiles.updated_at trigger. Noncandidate rows have no ledger.
CREATE TRIGGER sexytw_resume_parent_revision AFTER UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sexytw_resume_touch_v2();
CREATE TRIGGER sexytw_resume_city_revision AFTER INSERT OR UPDATE OR DELETE ON public.profile_cities FOR EACH ROW EXECUTE FUNCTION public.sexytw_resume_touch_v2();
CREATE TRIGGER sexytw_resume_image_revision AFTER INSERT OR UPDATE OR DELETE ON public.profile_images FOR EACH ROW EXECUTE FUNCTION public.sexytw_resume_touch_v2();
CREATE TRIGGER sexytw_resume_source_image_revision AFTER INSERT OR UPDATE OR DELETE ON public.profile_source_images FOR EACH ROW EXECUTE FUNCTION public.sexytw_resume_touch_v2();

CREATE FUNCTION public.sexytw_resume_assert_original_v2(p_operation uuid) RETURNS public.sexytw_resume_operations_v2 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2; p public.profiles;
BEGIN
 -- Match existing completion's child-table lock boundary. Parent-before-ledger
 -- ordering avoids reversing the row order used by the mutation trigger.
 SELECT * INTO o FROM public.sexytw_resume_operations_v2 WHERE id=p_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'resume-unknown-attempt-no-legacy-adoption'; END IF;
 LOCK TABLE public.profile_images,public.profile_source_images,public.profile_cities IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO p FROM public.profiles WHERE id=o.profile_id FOR UPDATE;
 SELECT * INTO o FROM public.sexytw_resume_operations_v2 WHERE id=p_operation FOR UPDATE;
 IF o.state<>'open' OR p.id IS NULL OR to_jsonb(p) IS DISTINCT FROM o.expected_profile
    OR o.mutation_revision<>o.expected_revision OR p.status<>'draft'
    OR p.source_content_hash IS DISTINCT FROM ('create-only:resume-v2:'||o.id::text)
    OR (to_jsonb(p)->>'source_missing_at') IS NOT NULL
 THEN RAISE EXCEPTION 'resume-original-parent-child-presence-CAS-conflict'; END IF;
 IF (SELECT count(*) FROM public.profile_cities WHERE profile_id=p.id)<>1
    OR NOT EXISTS(SELECT 1 FROM public.profile_cities WHERE profile_id=p.id AND city_id=o.city_id)
    OR EXISTS(SELECT 1 FROM public.profile_images WHERE profile_id=p.id)
    OR EXISTS(SELECT 1 FROM public.profile_source_images WHERE profile_id=p.id)
 THEN RAISE EXCEPTION 'resume-original-children-changed'; END IF;
 RETURN o;
END $$;
CREATE FUNCTION public.sexytw_resume_lock_v2(p_operation uuid,p_lease uuid,p_epoch bigint) RETURNS public.sexytw_resume_operations_v2 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2;
BEGIN
 PERFORM public.sexytw_resume_require_enabled_v2();
 o:=public.sexytw_resume_assert_original_v2(p_operation);
 IF p_lease IS NULL OR p_epoch IS NULL OR o.lease_token IS DISTINCT FROM p_lease
    OR o.epoch IS DISTINCT FROM p_epoch OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'resume-stale-or-expired-fence'; END IF;
 IF o.latest_capture<clock_timestamp()-interval '1 hour' OR o.latest_capture>clock_timestamp()+interval '15 seconds'
 THEN RAISE EXCEPTION 'resume-stale-capture'; END IF;
 RETURN o;
END $$;

CREATE FUNCTION public.sexytw_resume_begin_v2(p_provider text,p_source_key text,p_captured_at timestamptz,p_content_hash text,p_city_id uuid,p_draft jsonb,p_images jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2; p public.profiles; intent_value jsonb; operation_id uuid:=gen_random_uuid(); lease_id uuid:=gen_random_uuid();
BEGIN
 PERFORM public.sexytw_resume_require_enabled_v2();
 IF p_provider IS DISTINCT FROM 'edc-public-catalog' OR p_source_key IS NULL OR p_source_key!~'^[a-z0-9_-]{1,80}$'
   OR p_content_hash IS NULL OR p_content_hash!~'^[a-f0-9]{64}$'
   OR p_captured_at IS NULL OR p_captured_at<clock_timestamp()-interval '1 hour' OR p_captured_at>clock_timestamp()+interval '15 seconds'
   OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR p_draft->>'status' IS DISTINCT FROM 'draft'
   OR p_draft->>'adult_review_status' IS NULL OR p_draft->>'adult_review_status' NOT IN('verified','pending')
   OR p_draft->>'source_provider' IS DISTINCT FROM p_provider OR p_draft->>'source_key' IS DISTINCT FROM p_source_key
   OR p_draft->>'source_url' IS NULL OR p_draft->>'source_url' !~ '^https://edc[.]com[.]tw/[^/]' OR p_draft->>'source_url' LIKE 'https://edc.com.tw/wp-json/%'
   OR jsonb_typeof(p_images) IS DISTINCT FROM 'array' OR jsonb_array_length(p_images) NOT BETWEEN 1 AND 3
 THEN RAISE EXCEPTION 'resume-invalid-admission'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_images) x WHERE x->>'url' IS NULL OR x->>'url' !~ '^https://(www[.])?edc[.]com[.]tw/' OR jsonb_typeof(x->'alt') IS DISTINCT FROM 'string')
   OR (SELECT count(DISTINCT x->>'url') FROM jsonb_array_elements(p_images) x)<>jsonb_array_length(p_images)
 THEN RAISE EXCEPTION 'resume-invalid-source-images'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cities WHERE id=p_city_id) THEN RAISE EXCEPTION 'resume-city-not-found'; END IF;
 -- Fresh capture metadata is not a new content revision. Original captured row
 -- remains immutable; replay must still match every source-owned draft field.
 intent_value:=jsonb_build_object('draft',p_draft-ARRAY['source_content_hash','source_last_seen_at','adult_verified_at'],'images',p_images,'cityId',p_city_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('sexytw-resume-v2:'||p_provider||':'||p_source_key,0));
 SELECT * INTO o FROM public.sexytw_resume_operations_v2 WHERE provider=p_provider AND source_key=p_source_key;
 IF FOUND THEN
   IF o.state='done' THEN
     IF o.content_hash=p_content_hash AND o.intent=intent_value THEN RETURN o.receipt||jsonb_build_object('outcome','replayed'); END IF;
     RETURN jsonb_build_object('outcome','skipped-existing');
   END IF;
   IF o.content_hash<>p_content_hash OR o.intent IS DISTINCT FROM intent_value OR p_captured_at<o.original_capture OR p_captured_at<o.latest_capture
   THEN RAISE EXCEPTION 'resume-original-identity-revision-capture-mismatch'; END IF;
   o:=public.sexytw_resume_assert_original_v2(o.id);
   IF o.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'resume-owned-attempt-busy'; END IF;
   UPDATE public.sexytw_resume_operations_v2 SET lease_token=lease_id,lease_until=clock_timestamp()+interval '180 seconds',epoch=epoch+1,latest_capture=p_captured_at WHERE id=o.id RETURNING * INTO o;
 ELSE
   SELECT * INTO p FROM public.profiles WHERE source_provider=p_provider AND source_key=p_source_key FOR UPDATE;
   IF FOUND THEN
     IF p.source_content_hash LIKE 'create-only:%' THEN RAISE EXCEPTION 'resume-legacy-incomplete-requires-separate-review'; END IF;
     RETURN jsonb_build_object('outcome','skipped-existing');
   END IF;
   INSERT INTO public.profiles(slug,display_name,style,interest,introduction,status,sort_order,seo_title,seo_description,source_provider,source_key,source_url,source_content_hash,source_last_seen_at,adult_review_status,adult_verified_at,adult_verified_by)
   VALUES(p_draft->>'slug',p_draft->>'display_name',p_draft->>'style',p_draft->>'interest',p_draft->>'introduction','draft',COALESCE((p_draft->>'sort_order')::integer,99),p_draft->>'seo_title',p_draft->>'seo_description',p_provider,p_source_key,p_draft->>'source_url','create-only:resume-v2:'||operation_id::text,p_captured_at,p_draft->>'adult_review_status',CASE WHEN p_draft->>'adult_review_status'='verified' THEN p_captured_at ELSE NULL END,NULL)
   ON CONFLICT(source_provider,source_key) DO NOTHING RETURNING * INTO p;
   IF p.id IS NULL THEN RAISE EXCEPTION 'resume-concurrent-existing-profile-no-adoption'; END IF;
   INSERT INTO public.sexytw_resume_operations_v2(id,provider,source_key,profile_id,content_hash,city_id,original_capture,latest_capture,intent,expected_profile,lease_token,lease_until,epoch)
   VALUES(operation_id,p_provider,p_source_key,p.id,p_content_hash,p_city_id,p_captured_at,p_captured_at,intent_value,to_jsonb(p),lease_id,clock_timestamp()+interval '180 seconds',1);
   INSERT INTO public.profile_cities(profile_id,city_id) VALUES(p.id,p_city_id);
   UPDATE public.sexytw_resume_operations_v2 SET expected_revision=mutation_revision WHERE id=operation_id RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('operationId',o.id,'leaseToken',o.lease_token,'epoch',o.epoch,'leaseUntil',o.lease_until,'plans',o.image_plans,'proofs',o.object_proofs);
END $$;

CREATE FUNCTION public.sexytw_resume_pin_image_v2(p_operation uuid,p_lease uuid,p_epoch bigint,p_index integer,p_sha256 text,p_size integer,p_content_type text,p_extension text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2; plan jsonb; original jsonb;
BEGIN
 o:=public.sexytw_resume_lock_v2(p_operation,p_lease,p_epoch);
 IF p_index IS NULL OR p_index<0 OR p_index>=jsonb_array_length(o.intent->'images') OR p_index>jsonb_array_length(o.image_plans)
    OR p_sha256 IS NULL OR p_sha256!~'^[a-f0-9]{64}$' OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 15728640
    OR p_content_type IS NULL OR p_content_type NOT IN('image/jpeg','image/png','image/webp','image/avif')
    OR p_extension IS NULL OR p_extension NOT IN('jpg','jpeg','png','webp','avif')
 THEN RAISE EXCEPTION 'resume-invalid-image-plan'; END IF;
 original:=o.intent->'images'->p_index;
 plan:=jsonb_build_object('index',p_index,'url',original->>'url','alt',original->>'alt','sha256',p_sha256,'size',p_size,'contentType',p_content_type,'extension',p_extension,
    'storagePath','sexytw/resume-v2/'||o.id::text||'/'||p_index::text||'-'||p_sha256||'.'||p_extension);
 IF o.image_plans->p_index IS NOT NULL AND o.image_plans->p_index IS DISTINCT FROM plan THEN RAISE EXCEPTION 'resume-original-byte-plan-changed'; END IF;
 UPDATE public.sexytw_resume_operations_v2 SET image_plans=jsonb_set(image_plans,ARRAY[p_index::text],plan,true) WHERE id=o.id;
 RETURN plan;
END $$;
CREATE FUNCTION public.sexytw_resume_record_object_v2(p_operation uuid,p_lease uuid,p_epoch bigint,p_index integer,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2; plan jsonb; provider_id text;
BEGIN
 o:=public.sexytw_resume_lock_v2(p_operation,p_lease,p_epoch);plan:=o.image_plans->p_index;
 SELECT immutable_proof_provider INTO provider_id FROM public.sexytw_resume_config_v2 WHERE singleton;
 IF plan IS NULL OR p_index<0 OR p_index>jsonb_array_length(o.object_proofs)
    OR p_proof->>'storeId' IS DISTINCT FROM provider_id OR p_proof->>'storagePath' IS DISTINCT FROM plan->>'storagePath'
    OR p_proof->>'sha256' IS DISTINCT FROM plan->>'sha256' OR p_proof->'size' IS DISTINCT FROM plan->'size'
    OR p_proof->>'contentType' IS DISTINCT FROM plan->>'contentType' OR COALESCE(p_proof->>'version','')=''
    OR p_proof->'immutable' IS DISTINCT FROM 'true'::jsonb OR p_proof->'validatedImage' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'resume-object-proof-mismatch'; END IF;
 IF o.object_proofs->p_index IS NOT NULL AND o.object_proofs->p_index IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'resume-immutable-object-version-changed'; END IF;
 UPDATE public.sexytw_resume_operations_v2 SET object_proofs=jsonb_set(object_proofs,ARRAY[p_index::text],p_proof,true) WHERE id=o.id;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.sexytw_resume_complete_v2(p_operation uuid,p_lease uuid,p_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.sexytw_resume_operations_v2; p public.profiles; plan jsonb; proof jsonb; result jsonb; idx integer;
BEGIN
 PERFORM public.sexytw_resume_require_enabled_v2();
 SELECT * INTO o FROM public.sexytw_resume_operations_v2 WHERE id=p_operation;
 IF FOUND AND o.state='done' THEN RETURN o.receipt||jsonb_build_object('outcome','replayed'); END IF;
 o:=public.sexytw_resume_lock_v2(p_operation,p_lease,p_epoch);
 IF jsonb_array_length(o.image_plans)<>jsonb_array_length(o.intent->'images') OR jsonb_array_length(o.object_proofs)<>jsonb_array_length(o.image_plans)
 THEN RAISE EXCEPTION 'resume-incomplete-image-proof'; END IF;
 FOR idx IN 0..jsonb_array_length(o.image_plans)-1 LOOP
   plan:=o.image_plans->idx;proof:=o.object_proofs->idx;
   -- Recheck the durable trusted proof contract, not merely a storage path.
   PERFORM public.sexytw_resume_record_object_v2(o.id,p_lease,p_epoch,idx,proof);
 END LOOP;
 FOR idx IN 0..jsonb_array_length(o.image_plans)-1 LOOP
   plan:=o.image_plans->idx;
   INSERT INTO public.profile_source_images(profile_id,source_url,storage_path,alt_text,sort_order) VALUES(o.profile_id,plan->>'url',plan->>'storagePath',plan->>'alt',idx);
   INSERT INTO public.profile_images(profile_id,storage_path,alt_text,sort_order) VALUES(o.profile_id,plan->>'storagePath',plan->>'alt',idx);
 END LOOP;
 UPDATE public.profiles SET source_content_hash=o.content_hash,card_image_path=o.image_plans->0->>'storagePath',
   status=CASE WHEN adult_review_status='verified' THEN 'published' ELSE 'draft' END WHERE id=o.profile_id RETURNING * INTO p;
 result:=jsonb_build_object('outcome','created','published',p.status='published','operationId',o.id,'profileId',p.id,'contentHash',o.content_hash,'completedAt',clock_timestamp(),'historical',true);
 UPDATE public.sexytw_resume_operations_v2 SET state='done',lease_token=NULL,lease_until=NULL,receipt=result,completed_at=clock_timestamp() WHERE id=o.id;
 RETURN result;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sexytw_resume_%_v2' LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
   IF f.signature::text NOT LIKE '%sexytw_resume_touch_v2%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
