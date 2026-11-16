// Server-side service adapter. No production storage/catalog provider is installed.
// Never obtain this capability from a request, public environment variable, URL,
// or an arbitrary HTTP endpoint. The service must be the scoped PublicRead entrypoint.
const pathPattern = /^\/media\/profile\/v2\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-2]-[0-9a-f]{64}\.(jpg|jpeg|png|webp|avif)$/;
const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
const headers = () => ({
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
});
const notFound = () => new Response(null, { status: 404, headers: headers() });

/** Intentionally disabled until an independently reviewed server binding exists. */
export function getTrustedProfileMediaService() { return null; }

/** Explicit dependency is for trusted server callers/tests, never request input. */
export async function handleProfileMediaRequest(request, { enabled = false, service = null } = {}) {
  if (enabled !== true || !service || service.kind !== 'scoped-profile-public-read-v2' || typeof service.fetch !== 'function') return notFound();
  try {
    const url = new URL(request.url);
    const match = pathPattern.exec(url.pathname);
    if (!match || url.search || url.hash || request.headers.has('Range') || !['GET', 'HEAD'].includes(request.method)) return notFound();
    // Only canonical method/path cross this service boundary. Do not forward
    // cookies, authorization, status hints, conditional cache headers, or host.
    const scopedRequest = new Request('https://profile-media.invalid' + url.pathname, { method: request.method });
    const response = await service.fetch(scopedRequest);
    const size = response?.headers?.get('Content-Length');
    if (!(response instanceof Response) || response.status !== 200 ||
      response.headers.has('Location') || response.headers.get('Content-Type') !== mime[match[1]] ||
      !size || !/^[1-9][0-9]*$/.test(size) || Number(size) > 15 * 1024 * 1024) {
      if (response instanceof Response) await response.body?.cancel();
      return notFound();
    }
    // PublicRead must finish both authorization checks and byte proof before
    // returning this body. Do not expose its headers, redirects or raw object URL.
    const outHeaders = { ...headers(), 'Content-Type': mime[match[1]], 'Content-Length': size };
    if (request.method === 'HEAD') {
      await response.body?.cancel();
      return new Response(null, { status: 200, headers: outHeaders });
    }
    return new Response(response.body, { status: 200, headers: outHeaders });
  } catch { return notFound(); }
}
