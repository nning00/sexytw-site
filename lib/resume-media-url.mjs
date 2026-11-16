// Browser-safe routing only. This flag is not an access-control decision.
// Even enabled, the server verifies the current record before sending bytes.
const namespace="sexytw/resume-v2/";
const relativePattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-2]-[0-9a-f]{64}\.(jpg|jpeg|png|webp|avif)$/;
export const resumeMediaPlaceholder="/placeholders/hero.svg";

export function resumeMediaUrl(path, enabled) {
  if (typeof path!=="string" || !path.startsWith(namespace)) return undefined;
  const relative=path.slice(namespace.length);
  if (enabled!=="1" || !relativePattern.test(relative)) return resumeMediaPlaceholder;
  return "/media/profile/v2/"+relative;
}

const guardedPrefix="/media/profile/v2/";
export function isResumeMediaPublicRoute(src) {
  return typeof src === "string" && src.startsWith(guardedPrefix) && relativePattern.test(src.slice(guardedPrefix.length));
}

export function isProtectedImageOptimizerRequest(url) {
  const optimizer = url.pathname.replace(/\/+$/, "");
  if (optimizer !== "/_next/image" && optimizer !== "/_vinext/image") return false;
  for (const raw of url.searchParams.getAll("url")) {
    // Use the same slash normalization as Vinext, conservatively rejecting
    // alternate encodings for this namespace only. Never route it to the
    // optimizer, which can override the source's no-store header.
    let target = raw;
    for (let i = 0; i < 3; i++) {
      try {
        const p = new URL(target.replaceAll("\\", "/"), url.origin).pathname;
        if (p === guardedPrefix.slice(0,-1) || p.startsWith(guardedPrefix)) return true;
        const decoded = decodeURIComponent(target);
        if (decoded === target) break;
        target = decoded;
      } catch { break; }
    }
  }
  return false;
}
