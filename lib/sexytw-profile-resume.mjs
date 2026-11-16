// Additive, default-off candidate. No production immutable store is installed.
// A caller-supplied JSON object is NEVER an authorized store implementation.
import { createHash } from "node:crypto";

/** @returns {null} */
export function getTrustedResumeStore() { return null; }
const fail = (condition, code) => { if (!condition) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const trusted = store => Boolean(store && store.proofVersion === 1
  && store.immutable === true && store.validatesImageBytes === true
  && typeof store.id === "string" && store.id.length > 0
  && typeof store.lookup === "function" && typeof store.putIfAbsent === "function"
  && typeof store.verifyImmutable === "function");
async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("resume-rpc-" + name + ": " + (error.message || "failed"));
  fail(data && typeof data === "object" && !Array.isArray(data), "resume-invalid-rpc-response");
  return data;
}
export async function getProfileResumeCapability(client, store) {
  // Critical: no DB call at all when the independently reviewed binding is absent.
  if (!trusted(store)) return false;
  try {
    const c = await rpc(client, "sexytw_resume_capability_v2");
    return c.version === 2 && c.enabled === true && c.immutableProofVersion === 1
      && c.immutableProofProvider === store.id;
  } catch { return false; }
}
function validate(input) {
  fail(input?.provider === "edc-public-catalog" && /^[a-z0-9_-]{1,80}$/.test(input.sourceKey), "resume-invalid-source-identity");
  fail(/^[a-f0-9]{64}$/.test(input.contentHash) && typeof input.cityId === "string", "resume-invalid-revision");
  const at = Date.parse(input.capturedAt);
  fail(Number.isFinite(at) && new Date(at).toISOString() === input.capturedAt
    && at <= Date.now() + 15000 && Date.now() - at <= 3600000, "resume-stale-capture");
  fail(input.draft && input.draft.status === "draft"
    && ["verified", "pending"].includes(input.draft.adult_review_status), "resume-invalid-draft-policy");
  fail(Array.isArray(input.images) && input.images.length >= 1 && input.images.length <= 3
    && new Set(input.images.map(i => i.url)).size === input.images.length, "resume-invalid-image-count");
  for (const image of input.images) {
    const u = new URL(image.url);
    fail(u.protocol === "https:" && ["edc.com.tw", "www.edc.com.tw"].includes(u.hostname)
      && !u.username && !u.password && !u.port && !u.hash && typeof image.alt === "string", "resume-invalid-image-source");
  }
}
function media(value) {
  fail(value?.bytes instanceof Uint8Array && value.bytes.length > 0 && value.bytes.length <= 15 * 1024 * 1024, "resume-image-size-invalid");
  fail(["image/jpeg", "image/png", "image/webp", "image/avif"].includes(value.contentType)
    && ["jpg", "jpeg", "png", "webp", "avif"].includes(value.extension), "resume-image-type-invalid");
  return { sha256: createHash("sha256").update(value.bytes).digest("hex"), size: value.bytes.length,
    contentType: value.contentType, extension: value.extension };
}
function checkProof(store, plan, proof) {
  fail(proof && proof.storeId === store.id && proof.storagePath === plan.storagePath
    && proof.sha256 === plan.sha256 && proof.size === plan.size && proof.contentType === plan.contentType
    && typeof proof.version === "string" && proof.version.length > 0
    && proof.validatedImage === true && proof.immutable === true, "resume-object-proof-mismatch");
  return proof;
}
function outcome(value, phase) {
  const allowed = phase === "begin" ? ["replayed", "skipped-existing"] : ["created", "replayed"];
  fail(allowed.includes(value?.outcome), "resume-invalid-outcome");
  if (value.outcome === "skipped-existing") fail(value.published === undefined, "resume-invalid-skipped-publication");
  else fail(typeof value.published === "boolean", "resume-missing-publication-receipt");
  return { outcome: value.outcome, ...(typeof value.published === "boolean" ? { published: value.published } : {}) };
}
export async function resumeCreateOnlyProfile(client, input, download, store) {
  // Defense in depth: even a direct invocation cannot bypass the default-off gate.
  fail(trusted(store), "resume-immutable-store-unavailable");
  validate(input);
  fail(await getProfileResumeCapability(client, store), "resume-capability-unavailable");
  const started = await rpc(client, "sexytw_resume_begin_v2", {
    p_provider: input.provider, p_source_key: input.sourceKey, p_captured_at: input.capturedAt,
    p_content_hash: input.contentHash, p_city_id: input.cityId, p_draft: input.draft, p_images: input.images,
  });
  if (started.outcome) return outcome(started, "begin");
  fail(typeof started.operationId === "string" && typeof started.leaseToken === "string"
    && Number.isSafeInteger(started.epoch) && started.epoch > 0, "resume-invalid-owned-attempt");
  const owned = { p_operation: started.operationId, p_lease: started.leaseToken, p_epoch: started.epoch };
  const proofs = [];
  for (const [index, image] of input.images.entries()) {
    let plan = started.plans?.[index] || null;
    let proof = started.proofs?.[index] || null;
    let downloaded;
    if (!plan) {
      downloaded = await download(image.url);
      const digest = media(downloaded);
      plan = await rpc(client, "sexytw_resume_pin_image_v2", { ...owned, p_index: index,
        p_sha256: digest.sha256, p_size: digest.size, p_content_type: digest.contentType, p_extension: digest.extension });
    }
    fail(plan.index === index && plan.url === image.url && plan.alt === image.alt
      && /^[a-f0-9]{64}$/.test(plan.sha256) && Number.isSafeInteger(plan.size) && plan.size > 0
      && plan.size <= 15 * 1024 * 1024 && typeof plan.storagePath === "string"
      && plan.storagePath.startsWith("sexytw/resume-v2/" + started.operationId + "/"), "resume-invalid-pinned-plan");
    if (!proof) proof = await store.lookup(plan);
    if (!proof) {
      downloaded ??= await download(image.url);
      const observed = media(downloaded);
      fail(observed.sha256 === plan.sha256 && observed.size === plan.size
        && observed.contentType === plan.contentType && observed.extension === plan.extension, "resume-original-bytes-changed");
      // No retry, overwrite, upsert or deletion fallback. A lost acknowledgement
      // is reconciled by lookup+cryptographic proof on a later owned invocation.
      proof = await store.putIfAbsent(plan, downloaded.bytes);
    }
    checkProof(store, plan, proof);
    const verified = checkProof(store, plan, await store.verifyImmutable(proof));
    fail(same(verified, proof), "resume-immutable-version-changed");
    await rpc(client, "sexytw_resume_record_object_v2", { ...owned, p_index: index, p_proof: verified });
    proofs.push({ plan, proof: verified });
  }
  for (const { plan, proof } of proofs) {
    const fresh = checkProof(store, plan, await store.verifyImmutable(proof));
    fail(same(fresh, proof), "resume-immutable-version-changed");
    await rpc(client, "sexytw_resume_record_object_v2", { ...owned, p_index: plan.index, p_proof: fresh });
  }
  return outcome(await rpc(client, "sexytw_resume_complete_v2", owned), "complete");
}
