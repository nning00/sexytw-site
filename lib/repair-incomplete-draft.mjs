import {createHash, randomUUID} from 'node:crypto';
import {prefetchSourceImages} from './source-image-download.mjs';

export async function repairIncompleteDraft(client, current, profile, {download} = {}) {
  if (current.status !== 'draft' || !/^create-only:[0-9a-f-]{36}$/.test(current.source_content_hash || '')
    || !current.created_at || current.created_at !== current.updated_at || current.card_image_path
    || current.source_url !== profile.sourceUrl) throw Error('incomplete-new-draft-requires-review');
  const [images, sources, cities] = await Promise.all([
    client.from('profile_images').select('storage_path').eq('profile_id',current.id),
    client.from('profile_source_images').select('storage_path').eq('profile_id',current.id),
    client.from('profile_cities').select('city_id').eq('profile_id',current.id),
  ]);
  if (images.error || sources.error || cities.error || images.data?.length || sources.data?.length || cities.data?.length !== 1)
    throw Error('incomplete-new-draft-requires-review');
  const downloaded = await prefetchSourceImages(profile.images,download);
  const attempt = randomUUID(); const proof = [];
  for (const [index, image] of profile.images.entries()) {
    const file = downloaded.get(image.url);
    const hash = createHash('sha256').update(image.url).digest('hex').slice(0,24);
    const path = `sexytw/profiles/synced/${current.id}/repair-${attempt}/${hash}.${file.extension}`;
    const {error} = await client.storage.from('site-media').upload(path,file.bytes,{upsert:false,contentType:file.contentType,cacheControl:'31536000'});
    if (error) throw Error('draft-repair-upload-failed');
    proof.push({storage_path:path,source_url:image.url,alt_text:image.alt || '形象照片',sort_order:index+1});
  }
  // This transaction rechecks the parent and every child table after upload.
  // It can only fill untouched drafts and never publishes or deletes anything.
  const {data, error} = await client.rpc('sexytw_repair_incomplete_draft',{
    p_id:current.id,p_marker:current.source_content_hash,p_expected_updated_at:current.updated_at,
    p_source_url:profile.sourceUrl,p_city_id:cities.data[0].city_id,p_images:proof,
  });
  if (error || data?.ok !== true || data?.status !== 'draft') throw Error('incomplete-new-draft-requires-review');
}
