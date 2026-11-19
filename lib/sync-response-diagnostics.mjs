const metadata = new WeakMap();
const known = new Map([
  ['incomplete-new-draft-requires-review', 'incomplete_draft'],
  ['image-download-404', 'image_not_found'],
  ['image-download-401', 'image_unauthorized'],
  ['image-download-403', 'image_forbidden'],
  ['image-download-429', 'image_rate_limited'],
  ['image-content-type-invalid', 'image_type_invalid'],
  ['image-size-invalid', 'image_size_invalid'],
  ['image-network-or-timeout', 'image_network_or_timeout'],
  ['image-redirect-rejected', 'image_redirect_rejected'],
  ['image-url-invalid', 'image_url_invalid'],
  ['draft-repair-upload-failed', 'draft_repair_upload_failed'],
  ['New profile requires complete images', 'images_incomplete'],
]);
export function errorCategories(errors) {
  const counts = { incomplete_draft: 0, image_not_found: 0, image_unauthorized: 0, image_forbidden: 0, image_rate_limited: 0, image_server_error: 0, image_type_invalid: 0, image_size_invalid: 0, image_network_or_timeout: 0, image_redirect_rejected: 0, image_url_invalid: 0, draft_repair_upload_failed: 0, images_incomplete: 0, unknown: 0 };
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
const transportCodes = new Set(['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENOTFOUND','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','EPIPE','ABORT_ERR','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','SYNC_CONNECT_TIMEOUT','SYNC_RESPONSE_LIMIT','SYNC_RESPONSE_INCOMPLETE','SYNC_REUSED_SOCKET']);
export class SafeSyncTransportError extends Error {
  constructor({code,phase,sent,attempt,elapsedMs}) {
    const diagnostic = Object.freeze({kind:'sync-transport',code:transportCodes.has(code)?code:'UNKNOWN',phase:['connect','request','response'].includes(phase)?phase:'unknown',sent:sent===true,attempt:Number.isSafeInteger(attempt)&&attempt>=1&&attempt<=3?attempt:0,elapsedMs:Number.isFinite(elapsedMs)?Math.max(0,Math.min(3600000,Math.round(elapsedMs))):0});
    super(JSON.stringify(diagnostic));
    this.diagnostic = diagnostic;
  }
}
export function responseDiagnostic(value) {
  return value && typeof value === 'object' && metadata.get(value) || {
    status: null, media: 'missing', envelope: 'invalid',
    errors: errorCategories([]),
  };
}
export function safeFailure(error) {
  if (error instanceof SafeSyncResponseError || error instanceof SafeSyncTransportError) return error.message;
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
