-- OFFLINE REVIEW CANDIDATE. Target sexytw only. No automatic deletion.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS source_missing_at timestamptz;
CREATE TABLE public.sexytw_source_receipts(captured_at timestamptz PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now(),source_keys text[] NOT NULL,source_count integer NOT NULL CHECK(source_count=cardinality(source_keys)));
ALTER TABLE public.sexytw_source_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sexytw_source_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.sexytw_source_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.sexytw_profile_updated_at() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-'source_last_seen_at'-'source_missing_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'source_last_seen_at'-'source_missing_at'-'updated_at') THEN NEW.updated_at:=now(); ELSE NEW.updated_at:=OLD.updated_at; END IF;
 RETURN NEW;
END $$;
-- Retain signature/permissions, but make legacy destructive endpoint fail closed.
CREATE OR REPLACE FUNCTION public.sexytw_finalize_profile_batch(p_seen_keys text[],p_captured_at timestamptz,p_after_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Legacy permanent cleanup disabled'; END $$;
CREATE OR REPLACE FUNCTION public.sexytw_finalize_presence_v3(p_keys text[],p_at timestamptz,p_proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE last_at timestamptz; total integer; missing integer; hidden integer; seen integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('sexytw-presence-v3'));
 IF p_at IS NULL OR p_at<now()-interval '8 hours' OR p_at>now()
 OR coalesce(cardinality(p_keys),0) NOT BETWEEN 1 AND 50000
 OR EXISTS(SELECT 1 FROM unnest(p_keys) k WHERE k IS NULL OR k !~ '^[0-9]{1,80}$')
 OR cardinality(p_keys)<>(SELECT count(DISTINCT k) FROM unnest(p_keys) k)
 OR coalesce((p_proof->>'complete')::boolean,false) IS NOT TRUE
 OR (p_proof->>'sourceTotal')::integer IS DISTINCT FROM cardinality(p_keys)
 OR (p_proof->>'rawCount')::integer IS DISTINCT FROM cardinality(p_keys)
 OR (p_proof->>'sourcePages')::integer IS DISTINCT FROM ceil(cardinality(p_keys)/100.0)::integer
 OR (p_proof->>'pagesFetched')::integer IS DISTINCT FROM (p_proof->>'sourcePages')::integer
 OR (p_proof->>'importErrors')::integer IS DISTINCT FROM 0
 OR (p_proof->>'importWarnings')::integer IS DISTINCT FROM 0
 THEN RAISE EXCEPTION 'Invalid complete snapshot'; END IF;
 SELECT max(captured_at) INTO last_at FROM public.sexytw_source_receipts;
 IF last_at IS NOT NULL AND p_at<=last_at THEN RAISE EXCEPTION 'Stale snapshot'; END IF;
 LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*) INTO total FROM public.profiles WHERE source_provider='edc-public-catalog';
 SELECT count(*) INTO missing FROM public.profiles WHERE source_provider='edc-public-catalog' AND source_url LIKE 'https://edc.com.tw/%' AND NOT(source_key=ANY(p_keys)) AND source_missing_at IS NULL AND updated_at<p_at AND (source_last_seen_at IS NULL OR source_last_seen_at<=p_at);
 -- Conservative provisional threshold; must be reviewed before rollout.
 IF missing>100 OR missing>total*0.05 THEN RAISE EXCEPTION 'Bulk absence requires review'; END IF;
 UPDATE public.profiles SET source_missing_at=now() WHERE source_provider='edc-public-catalog' AND source_url LIKE 'https://edc.com.tw/%' AND NOT(source_key=ANY(p_keys)) AND source_missing_at IS NULL AND updated_at<p_at AND (source_last_seen_at IS NULL OR source_last_seen_at<=p_at);
 GET DIAGNOSTICS hidden=ROW_COUNT;
 UPDATE public.profiles SET source_missing_at=NULL,source_last_seen_at=p_at WHERE source_provider='edc-public-catalog' AND source_key=ANY(p_keys) AND (source_last_seen_at IS NULL OR source_last_seen_at<=p_at);
 GET DIAGNOSTICS seen=ROW_COUNT;
 INSERT INTO public.sexytw_source_receipts(captured_at,source_keys,source_count) VALUES(p_at,p_keys,cardinality(p_keys));
 RETURN jsonb_build_object('complete',true,'hidden',hidden,'seen',seen,'deleted',0,'imagesDeleted',0);
END $$;
REVOKE ALL ON FUNCTION public.sexytw_finalize_presence_v3(text[],timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_finalize_presence_v3(text[],timestamptz,jsonb) TO service_role;
ALTER POLICY public_read ON public.profiles TO anon,authenticated USING ((status='published' AND adult_review_status='verified' AND source_missing_at IS NULL) OR public.is_admin());
CREATE OR REPLACE FUNCTION public.sexytw_pending_removal_review() RETURNS TABLE(profile_id uuid,slug text,source_key text,missing_since timestamptz,latest_source_at timestamptz,version timestamptz,image_count bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH latest AS(SELECT * FROM public.sexytw_source_receipts ORDER BY captured_at DESC LIMIT 1)
 SELECT p.id,p.slug,p.source_key,p.source_missing_at,s.captured_at,p.updated_at,(SELECT count(*) FROM public.profile_images i WHERE i.profile_id=p.id)
 FROM public.profiles p CROSS JOIN latest s WHERE p.source_provider='edc-public-catalog' AND p.source_missing_at<=now()-interval '72 hours'
 AND s.completed_at>=now()-interval '8 hours' AND s.captured_at>=p.source_missing_at+interval '72 hours'
 AND NOT(p.source_key=ANY(s.source_keys)) AND p.updated_at<=p.source_missing_at AND (p.source_last_seen_at IS NULL OR p.source_last_seen_at<p.source_missing_at) ORDER BY p.source_missing_at,p.id;
$$;
REVOKE ALL ON FUNCTION public.sexytw_pending_removal_review() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sexytw_pending_removal_review() TO service_role;
COMMIT;
