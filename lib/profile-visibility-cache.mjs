export function isProfileVisibilityPath(path) {
  return /^\/profiles\/[^/]+\/?$/.test(path) || /^\/regions\/[^/]+\/[^/]+\/?$/.test(path)
    || path === '/sitemap.xml' || path === '/api/city-profiles';
}
export function applyProfileNoStore(response) {
  for (const header of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control']) response.headers.set(header,'private, no-store, max-age=0');
  return response;
}
