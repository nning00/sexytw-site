// An extra GET may use at most six seconds once per whole POST. Original
// successful first attempts keep their prior deadline behavior.
export const IMAGE_RETRY_POLICY = Object.freeze({ maxRetries: 1, retryTimeoutMs: 5000, maxDelayMs: 1000, retryCutoffMs: 90000 });
const STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525]);
const CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
export function createImageRetryBudget({ now = Date.now } = {}) {
  const cutoff = now() + IMAGE_RETRY_POLICY.retryCutoffMs;
  let remaining = IMAGE_RETRY_POLICY.maxRetries;
  return {
    reserve(delayMs) {
      if (!remaining || now() + delayMs + IMAGE_RETRY_POLICY.retryTimeoutMs > cutoff) return false;
      remaining -= 1;
      return true;
    },
    canStart() { return now() + IMAGE_RETRY_POLICY.retryTimeoutMs <= cutoff; },
  };
}
function delayFor(response, now) {
  const raw = response?.headers.get("retry-after");
  if (raw === null || raw === undefined) return 250;
  const text = raw.trim();
  const ms = /^\d+$/.test(text) ? Number(text) * 1000
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text) ? Date.parse(text) - now : NaN;
  return !Number.isFinite(ms) || ms > IMAGE_RETRY_POLICY.maxDelayMs ? null : Math.max(250, ms);
}
export async function fetchSourceImage(url, options, budget, {
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  makeRetrySignal = () => AbortSignal.timeout(IMAGE_RETRY_POLICY.retryTimeoutMs),
} = {}) {
  if (options.method || options.body) throw new Error("image-get-only");
  let response, failure;
  try { response = await fetchImpl(url, options); }
  catch (error) {
    if (!CODES.has(error?.cause?.code ?? error?.code)) throw error;
    failure = error;
  }
  if (response && !STATUSES.has(response.status)) return response;
  const fail = () => { if (failure) throw failure; return response; };
  const target = new URL(url);
  // Existing first-request options (including redirect default) stay unchanged.
  // Extra attempts are narrower: same approved source only, no redirects.
  if (target.protocol !== "https:" || !["edc.com.tw", "www.edc.com.tw"].includes(target.hostname)
    || target.username || target.password || target.port || target.hash) return fail();
  const delay = delayFor(response, now());
  if (delay === null || !budget?.reserve(delay)) return fail();
  if (response?.body) void response.body.cancel().catch(() => {});
  await sleep(delay);
  if (!budget.canStart()) return fail(); // Timer scheduling delay must not eat the reserved margin.
  const retry = await fetchImpl(url, { ...options, method: "GET", redirect: "manual", signal: makeRetrySignal() });
  if (retry.redirected || (retry.status >= 300 && retry.status < 400)) {
    if (retry.body) void retry.body.cancel().catch(() => {});
    return fail();
  }
  return retry; // No loop and no write retry.
}
