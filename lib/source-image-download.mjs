// Retries are limited to transient reads. Never retry access denials or follow
// redirects to a different host. A failed read must not create a draft.
export async function downloadSourceImage(url, {fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms)), deadline = Date.now() + 70000} = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !['edc.com.tw', 'www.edc.com.tw'].includes(parsed.hostname)) throw Error('image-url-invalid');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) throw Error('image-network-or-timeout');
    let response;
    try {
      // Workers rejects redirect:"error" before sending the request. Manual
      // plus an explicit rejection below keeps the same no-redirect boundary.
      response = await fetcher(url, {redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(Math.min(20000,remaining)), headers:{Accept:'image/avif,image/webp,image/png,image/jpeg',Referer:'https://edc.com.tw/','User-Agent':'AuthorizedProfileSync/1.0'}});
    } catch {
      if (attempt === 2) throw Error('image-network-or-timeout');
      await pause((attempt + 1) * 3000); continue;
    }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw Error('image-redirect-rejected'); }
    if (response.status >= 500 && attempt < 2) { await response.body?.cancel(); await pause((attempt + 1) * 3000); continue; }
    if (!response.ok) throw Error(`image-download-${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const extension = new Map([['image/webp','webp'],['image/png','png'],['image/avif','avif'],['image/jpeg','jpg']]).get(contentType);
    if (!extension) { await response.body?.cancel(); throw Error('image-content-type-invalid'); }
    const reader = response.body?.getReader();
    if (!reader) throw Error('image-size-invalid');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 15 * 1024 * 1024) { await reader.cancel(); throw Error('image-size-invalid'); }
        chunks.push(value);
      }
    } catch (error) { throw Error(error.message === 'image-size-invalid' ? 'image-size-invalid' : 'image-network-or-timeout'); }
    if (!size) throw Error('image-size-invalid');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return {bytes, contentType, extension};
  }
  throw Error('image-network-or-timeout');
}

export async function prefetchSourceImages(images, download) {
  if (!images.length || images.length > 3) throw Error('New profile requires complete images');
  const result = new Map(); const deadline = Date.now() + 70000; let size = 0;
  for (const image of images) {
    const file = await (download ? download(image.url) : downloadSourceImage(image.url,{deadline}));
    size += file.bytes?.byteLength || 0;
    if (size > 24 * 1024 * 1024) throw Error('image-size-invalid');
    result.set(image.url,file);
  }
  return result;
}
