-- Append after the installer BEGIN/body, replacing its COMMIT. Always ROLLBACK.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  old_time timestamptz := '2020-01-01T00:00:00Z';
  observed_time timestamptz;
  keys text[];
  result jsonb;
  test_cursor uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff0';
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.profiles WHERE id > test_cursor), 'Fixture cursor overlaps real data';
  ASSERT NOT has_function_privilege('anon', 'public.sexytw_finalize_profile_batch(text[],timestamptz,uuid)', 'EXECUTE'), 'Anonymous RPC access';
  ASSERT NOT has_function_privilege('authenticated', 'public.sexytw_finalize_profile_batch(text[],timestamptz,uuid)', 'EXECUTE'), 'Authenticated RPC access';
  ASSERT NOT has_table_privilege('anon', 'public.sexytw_media_cleanup_queue', 'SELECT'), 'Anonymous queue access';
  INSERT INTO public.profiles(id,slug,display_name,status,source_provider,source_key,source_url,updated_at)
  VALUES
    ('ffffffff-ffff-ffff-ffff-fffffffffff1','sync-test-missing-one','Synthetic fixture','draft','edc-public-catalog','9999999001','https://edc.com.tw/synthetic-fixture',old_time),
    ('ffffffff-ffff-ffff-ffff-fffffffffff2','sync-test-missing-two','Synthetic fixture','draft','edc-public-catalog','9999999002','https://edc.com.tw/synthetic-fixture',old_time),
    ('ffffffff-ffff-ffff-ffff-fffffffffff3','sync-test-present','Synthetic fixture','draft','edc-public-catalog','9999999003','https://edc.com.tw/synthetic-fixture',old_time),
    ('ffffffff-ffff-ffff-ffff-fffffffffff4','sync-test-manual','Synthetic fixture','draft',NULL,NULL,NULL,old_time);
  UPDATE public.profiles SET source_last_seen_at=now() WHERE id='ffffffff-ffff-ffff-ffff-fffffffffff3';
  SELECT updated_at INTO observed_time FROM public.profiles WHERE id='ffffffff-ffff-ffff-ffff-fffffffffff3';
  ASSERT observed_time=old_time, 'Presence-only write changed public updated_at';
  UPDATE public.profiles SET introduction='Changed fixture' WHERE id='ffffffff-ffff-ffff-ffff-fffffffffff3';
  SELECT updated_at INTO observed_time FROM public.profiles WHERE id='ffffffff-ffff-ffff-ffff-fffffffffff3';
  ASSERT observed_time=now(), 'Real content edit did not change updated_at';
  INSERT INTO public.profile_images(profile_id,storage_path) VALUES
    ('ffffffff-ffff-ffff-ffff-fffffffffff1','sexytw/profiles/synced/synthetic-only.jpg'),
    ('ffffffff-ffff-ffff-ffff-fffffffffff2','sexytw/copied/synthetic-shared.jpg'),
    ('ffffffff-ffff-ffff-ffff-fffffffffff3','sexytw/copied/synthetic-shared.jpg');
  SELECT array_agg(source_key) INTO keys FROM public.profiles
    WHERE source_provider='edc-public-catalog' AND source_key NOT IN ('9999999001','9999999002');
  result := public.sexytw_finalize_profile_batch(keys,now(),test_cursor);
  ASSERT (result->>'deleted')::int=2, 'Missing fixtures not deleted';
  ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE slug='sync-test-present'), 'Source-present fixture deleted';
  ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE slug='sync-test-manual'), 'Manual fixture deleted';
  ASSERT NOT EXISTS(SELECT 1 FROM public.profile_images WHERE profile_id='ffffffff-ffff-ffff-ffff-fffffffffff1'), 'Cascade failed';
  ASSERT EXISTS(SELECT 1 FROM public.sexytw_media_cleanup_batch() WHERE storage_path='sexytw/profiles/synced/synthetic-only.jpg' AND can_delete), 'Missing image not queued';
  ASSERT EXISTS(SELECT 1 FROM public.sexytw_media_cleanup_batch() WHERE storage_path='sexytw/copied/synthetic-shared.jpg' AND NOT can_delete), 'Shared image not protected';
  ASSERT public.sexytw_owned_media_path('https://other.supabase.co/storage/v1/object/public/site-media/sexytw/a.jpg') IS NULL, 'Foreign media accepted';
END
$$;
SELECT 'PASS: deletion, cascade, shared-image protection, unchanged timestamp, manual/source-present protection, permissions; all fixtures rolled back' AS tests;
ROLLBACK;
