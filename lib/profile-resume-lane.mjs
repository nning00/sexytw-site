// Pre-release lane. Authentication and target checks happen before admission.
export const RESUME_RECOVERY_HEADER = "create-only-resume-v2";
export const RESUME_CAPTURE_MAX_AGE_MS = 60 * 60 * 1000;
export const RESUME_CAPTURE_MAX_FUTURE_MS = 15 * 1000;

export function isResumeRecovery(header) {
  return header === RESUME_RECOVERY_HEADER;
}

export function supportedRecoveryHeader(header) {
  return header == null || header === "create-only-v1" || isResumeRecovery(header);
}

export function resumeLaneAdmission(envValue, body, now = Date.now()) {
  if (envValue !== "1") return { ok: false, status: 409, code: "resume-disabled" };
  if (!body || body.mode !== "commit" || body.createOnly !== true ||
    body.deferRevalidation !== true || body.presenceSnapshot || body.finalizeSnapshot ||
    body.cleanupCursor !== undefined || body.snapshotProof !== undefined ||
    body.snapshotSourceKeys !== undefined || !Array.isArray(body.profiles) ||
    body.profiles.length !== 1) {
    return { ok: false, status: 400, code: "resume-requires-one-create-only-profile" };
  }
  const raw = body.capturedAt;
  const timestamp = typeof raw === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw)
    ? Date.parse(raw) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== raw ||
    timestamp > now + RESUME_CAPTURE_MAX_FUTURE_MS || now - timestamp > RESUME_CAPTURE_MAX_AGE_MS) {
    return { ok: false, status: 400, code: "resume-requires-fresh-canonical-capture" };
  }
  return { ok: true, capturedAt: raw };
}
