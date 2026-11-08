/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
}

const allowedTags = new Set(["site-settings", "profiles", "regions", "articles"]);

/** Parse untrusted JSON without assertions that hide null/array failures.
 * @param {unknown} value
 */
export function parseRevalidationInput(value) {
  const body = record(value);
  return {
    tags: [...new Set(strings(body.tags).filter(tag => allowedTags.has(tag)))],
    indexNowPaths: strings(body.indexNowPaths),
  };
}

/** @param {unknown} value */
export function parseArticleSaveResponse(value) {
  const body = record(value);
  return {
    ok: body.ok === true,
    error: typeof body.error === "string" && body.error ? body.error : "儲存請求失敗，請稍後再試。",
    indexNowPaths: strings(body.indexNowPaths),
  };
}
