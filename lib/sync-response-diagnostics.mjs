const metadata = new WeakMap();
const known = new Map([
  ['incomplete-new-draft-requires-review', 'incomplete_draft'],
  ['image-download-404', 'image_not_found'],
  ['image-download-401', 'image_unauthorized'],
  ['image-download-403', 'image_forbidden'],
  ['image-download-429', 'image_rate_limited'],
  ['image-content-type-invalid', 'image_type_invalid'],
  ['image-size-invalid', 'image_size_invalid'],
  ['New profile requires complete images', 'images_incomplete'],
]);
export function errorCategories(errors) {
  const counts = { incomplete_draft: 0, image_not_found: 0, image_unauthorized: 0, image_forbidden: 0, image_rate_limited: 0, image_server_error: 0, image_type_invalid: 0, image_size_invalid: 0, images_incomplete: 0, unknown: 0 };
  for (const entry of Array.isArray(errors) ? errors : []) {
    const message = entry?.message;
    const category = known.get(message) || (typeof message === 'string' && /^image-download-5[0-9]{2}$/.test(message) ? 'image_server_error' : 'unknown');
    counts[category] += 1;
  }
  return counts;
}
function mediaCategory(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'text/html') return 'html';
  if (type === 'text/plain') return 'text';
  return type ? 'other' : 'missing';
}
export class SafeSyncResponseError extends Error {
  constructor(diagnostic) { super(JSON.stringify(diagnostic)); }
}
export function responseDiagnostic(value) {
  return value && typeof value === 'object' && metadata.get(value) || {
    status: null, media: 'missing', envelope: 'invalid',
    errors: errorCategories([]),
  };
}
export function safeFailure(error) {
  if (error instanceof SafeSyncResponseError) return error.message;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'sync-timeout-or-abort';
  if (error instanceof TypeError) return 'sync-network-or-request-error';
  return 'sync-request-failed';
}
export async function readSyncResponse(response, {batch = false} = {}) {
  let value;
  let parsed = true;
  try { value = await response.json(); } catch { parsed = false; value = { error: `HTTP ${response.status}` }; }
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  const diagnostic = {
    status: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
    media: mediaCategory(response.headers.get('content-type')),
    envelope: !parsed ? 'non_json' : !object ? 'invalid' : value.ok === true ? 'success' : value.ok === false ? 'unsuccessful' : 'invalid',
    errors: errorCategories(object ? value.result?.errors : []),
  };
  if (object) metadata.set(value, diagnostic);
  // Keep maintenance/cleanup return semantics, including HTTP207 / ok:false.
  // Batch shape/ok validation remains the caller's fail-closed gate.
  if ((!response.ok && response.status !== 207) || (batch && (!parsed || !object))) throw new SafeSyncResponseError(diagnostic);
  return value;
}

export function safeBatchSummary(summary) {
  const output = {};
  for (const key of ['received','valid','invalid','create','update','unchanged','pendingReview','skippedCity']) {
    const value = summary?.[key];
    if (Number.isSafeInteger(value) && value >= 0) output[key] = value;
  }
  return output;
}
