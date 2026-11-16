import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTrustedProfileMediaService, handleProfileMediaRequest } from '../lib/sexytw-profile-media.mjs';
const path = '/media/profile/v2/12345678-0000-4000-8000-000000000001/0-' + 'a'.repeat(64) + '.png';
const request = (suffix = '', options = {}) => new Request('https://fixture.invalid' + path + suffix, options);
const service = fetch => ({ kind: 'scoped-profile-public-read-v2', fetch });
const ok = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '3', 'Cache-Control': 'public', ETag: 'unsafe', 'Set-Cookie': 'unsafe', 'X-Internal': 'hidden' } });
async function check(r, status) {
  assert.equal(r.status, status);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(r.headers.get('CDN-Cache-Control'), 'no-store');
  assert.equal(r.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
  for (const key of ['ETag', 'Set-Cookie', 'X-Internal', 'Location']) assert.equal(r.headers.has(key), false);
  if (status === 404) assert.equal((await r.arrayBuffer()).byteLength, 0);
  return r;
}
test('production getter is null; even enabled cannot fetch', async () => {
  assert.equal(getTrustedProfileMediaService(), null);
  await check(await handleProfileMediaRequest(request(), { enabled: true, service: getTrustedProfileMediaService() }), 404);
});
test('only boolean true enables; no service call when off or invalid kind', async () => {
  let calls = 0;
  const bound = service(async () => { calls++; return ok(); });
  for (const enabled of [undefined, false, '1', 1]) await check(await handleProfileMediaRequest(request(), { enabled, service: bound }), 404);
  await check(await handleProfileMediaRequest(request(), { enabled: true, service: { ...bound, kind: 'Writer' } }), 404);
  assert.equal(calls, 0);
});
test('explicit trusted fixture returns bytes and strips all uncontrolled headers', async () => {
  let received;
  const r = await check(await handleProfileMediaRequest(request('', { headers: { Cookie: 'private', Authorization: 'private', 'X-Profile-Status': 'published', 'If-None-Match': '*' } }), { enabled: true, service: service(async req => { received = req; return ok(); }) }), 200);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  assert.equal(received.url, 'https://profile-media.invalid' + path);
  assert.deepEqual([...received.headers], []);
});
test('HEAD has exact metadata but no response body', async () => {
  const r = await check(await handleProfileMediaRequest(request('', { method: 'HEAD' }), { enabled: true, service: service(async () => ok()) }), 200);
  assert.equal(r.headers.get('Content-Length'), '3');
  assert.equal((await r.arrayBuffer()).byteLength, 0);
});
test('malformed/query/range/unsupported methods do not invoke service', async () => {
  let calls = 0; const bound = service(async () => { calls++; return ok(); });
  const requests = [request('?published=1'), request('#fragment'), request('', { headers: { Range: 'bytes=0-1' } }), ...['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(method => request('', { method })), new Request('https://fixture.invalid/media/profile/v2/invalid'), new Request('https://fixture.invalid' + path.replace('/0-', '/3-'))];
  for (const req of requests) await check(await handleProfileMediaRequest(req, { enabled: true, service: bound }), 404);
  assert.equal(calls, 0);
});
test('service errors and every non-success status fail closed', async () => {
  for (const status of [302, 401, 403, 404, 429, 500, 503]) await check(await handleProfileMediaRequest(request(), { enabled: true, service: service(async () => new Response('private', { status })) }), 404);
  await check(await handleProfileMediaRequest(request(), { enabled: true, service: service(async () => { throw new Error('private'); }) }), 404);
  await check(await handleProfileMediaRequest(request(), { enabled: true, service: service(async () => null) }), 404);
});
test('bad MIME, missing/invalid/oversized length, or redirects fail closed', async () => {
  for (const extra of [{ 'Content-Type': 'text/html' }, { 'Content-Length': '0' }, { 'Content-Length': '-1' }, { 'Content-Length': '1e3' }, { 'Content-Length': String(15 * 1024 * 1024 + 1) }, { Location: 'https://raw.invalid/object' }]) {
    await check(await handleProfileMediaRequest(request(), { enabled: true, service: service(async () => new Response('x', { headers: { 'Content-Type': 'image/png', 'Content-Length': '3', ...extra } })) }), 404);
  }
  await check(await handleProfileMediaRequest(request(), { enabled: true, service: service(async () => new Response('x', { headers: { 'Content-Type': 'image/png' } })) }), 404);
});
test('actual route uses only private flag and disabled getter, no test injection or DB imports', () => {
  const code = readFileSync(new URL('../app/media/profile/v2/[operation]/[file]/route.ts', import.meta.url), 'utf8');
  assert.match(code, /process\.env\.PROFILE_SYNC_RESUME_MEDIA_V2 === '1'/);
  assert.match(code, /service: enabled \? getTrustedProfileMediaService\(\) : null/);
  assert.doesNotMatch(code, /NEXT_PUBLIC_|supabase|fixture|globalThis|fetch\(/);
  assert.match(code, /force-dynamic/);
  assert.match(code, /force-no-store/);
});
