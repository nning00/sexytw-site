import test from "node:test";
import assert from "node:assert/strict";
import { collectCatalog } from "../lib/edc-catalog.mjs";
import { changedFields, finalizeSnapshot, finishSnapshot, validateSnapshotProof } from "../lib/profile-sync-snapshot.mjs";

const capturedAt = "2026-11-07T08:00:00.000Z";
const now = Date.parse(capturedAt) + 60000;
const proof = { complete: true, sourceTotal: 2, sourcePages: 1, pagesFetched: 1, rawCount: 2 };
const body = { capturedAt, snapshotSourceKeys: ["1", "2"], snapshotProof: proof };

function pageSource(count, transform = (value) => value) {
  return async (page) => transform({
    data: Array.from({ length: Math.min(100, count - (page - 1) * 100) }, (_, i) => ({ id: (page - 1) * 100 + i + 1 })),
    headers: new Headers({ "x-wp-total": String(count), "x-wp-totalpages": String(Math.ceil(count / 100)) }),
  }, page);
}

test("reads all 1,105 identities over 12 pages, including the tail beyond 1,000", async () => {
  const result = await collectCatalog({ fetchPage: pageSource(1105), normalizeProduct: (p) => ({ sourceKey: String(p.id), cityName: "台北" }) });
  assert.equal(result.profiles.length, 1105);
  assert.equal(result.sourceKeys.at(-1), "1105");
  assert.equal(result.snapshotProof.complete, true);
  assert.equal(result.snapshotProof.pagesFetched, 12);
  validateSnapshotProof(result.snapshotProof, result.sourceKeys, capturedAt, now);
});

test("unparseable records remain in the source-presence set, preventing accidental deletion", async () => {
  const result = await collectCatalog({ fetchPage: pageSource(2), normalizeProduct: (p) => p.id === 1 ? { sourceKey: "1" } : null });
  assert.equal(result.profiles.length, 1);
  assert.deepEqual(result.sourceKeys, ["1", "2"]);
});

test("partial city/limited runs never authorize deletion", async () => {
  for (const options of [{ selectedCity: "台北" }, { limit: 1 }]) {
    const result = await collectCatalog({ ...options, fetchPage: pageSource(101), normalizeProduct: (p) => ({ sourceKey: String(p.id), cityName: "台北" }) });
    assert.equal(result.snapshotProof.complete, false);
    assert.throws(() => validateSnapshotProof(result.snapshotProof, result.sourceKeys, capturedAt, now));
  }
});

test("refuses empty, truncated, duplicate and changing source pages before any writes", async () => {
  for (const fetchPage of [
    pageSource(0),
    pageSource(101, (r, page) => page === 1 ? { ...r, data: r.data.slice(0, 99) } : r),
    pageSource(101, (r, page) => page === 2 ? { ...r, data: [{ id: 1 }] } : r),
    pageSource(101, (r, page) => page === 2 ? { ...r, headers: new Headers({ "x-wp-total": "102", "x-wp-totalpages": "2" }) } : r),
    pageSource(2, (r) => ({ ...r, headers: new Headers() })),
  ]) await assert.rejects(collectCatalog({ fetchPage, normalizeProduct: (p) => p }));
});

test("refuses invalid, duplicate, stale or future snapshot evidence", () => {
  validateSnapshotProof(proof, ["1", "2"], capturedAt, now);
  for (const args of [
    [undefined, ["1", "2"], capturedAt],
    [{ ...proof, complete: false }, ["1", "2"], capturedAt],
    [proof, ["1", "1"], capturedAt],
    [proof, ["1", "evil-key"], capturedAt],
    [{ ...proof, pagesFetched: 0 }, ["1", "2"], capturedAt],
    [proof, ["1", "2"], "2026-11-06T00:00:00Z"],
    [proof, ["1", "2"], "2026-11-08T00:00:00Z"],
  ]) assert.throws(() => validateSnapshotProof(...args, now));
});

test("unchanged content produces an empty patch instead of rewriting biography and SEO", () => {
  const current = { status: "published", introduction: "same", seo_title: "same", seo_description: "same", adult_verified_at: capturedAt };
  assert.deepEqual(changedFields(current, { ...current }), {});
  assert.deepEqual(changedFields(current, { ...current, status: "draft" }), { status: "draft" });
});

function fakeClient({ queued = [], dbError = null, storageError = null, ackError = null, page = {} } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return name === "sexytw_finalize_profile_batch"
        ? { data: { scanComplete: true, nextCursor: null, deleted: 0, ...page }, error: dbError }
        : { data: queued, error: null };
    },
    storage: { from(bucket) { return { async remove(paths) { calls.push({ bucket, remove: paths }); return { error: storageError }; } }; } },
    from(table) { return { delete() { return { async in(column, paths) { calls.push({ table, column, ack: paths }); return { error: ackError }; } }; } }; },
  };
}

test("invalid proof/cursor fails before DB or storage operations", async () => {
  for (const input of [{ ...body, snapshotProof: null }, { ...body, cleanupCursor: "other-site" }]) {
    const client = fakeClient();
    await assert.rejects(finalizeSnapshot(client, input, now));
    assert.equal(client.calls.length, 0);
  }
});

test("uses bounded cursor RPC and deletes only owned, unreferenced media", async () => {
  const client = fakeClient({ queued: [{ storage_path: "sexytw/profiles/old.jpg", can_delete: true }, { storage_path: "sexytw/copied/shared.jpg", can_delete: false }] });
  const result = await finalizeSnapshot(client, body, now);
  assert.equal(client.calls[0].name, "sexytw_finalize_profile_batch");
  assert.equal(client.calls[0].args.p_after_id, null);
  assert.deepEqual(client.calls.find((c) => c.remove).remove, ["sexytw/profiles/old.jpg"]);
  assert.equal(result.imagesRetained, 1);
  assert.equal(result.complete, true);
});

test("refuses foreign-site and traversal paths before storage deletion", async () => {
  for (const path of ["sexy00/a.jpg", "sexytw/../a.jpg", "sexytw/%2e%2e/a.jpg", "sexytw/a\\b.jpg", "https://other.example/a.jpg"]) {
    const client = fakeClient({ queued: [{ storage_path: path, can_delete: true }] });
    await assert.rejects(finalizeSnapshot(client, body, now));
    assert.equal(client.calls.some((c) => c.remove), false);
    assert.equal(client.calls.some((c) => c.ack), false);
  }
});

test("storage failure leaves its retry queue intact; DB errors never call storage", async () => {
  for (const options of [{ dbError: { message: "test" } }, { storageError: { message: "test" } }]) {
    const client = fakeClient({ ...options, queued: [{ storage_path: "sexytw/a.jpg", can_delete: true }] });
    await assert.rejects(finalizeSnapshot(client, body, now));
    assert.equal(client.calls.some((c) => c.ack), false);
    if (options.dbError) assert.equal(client.calls.some((c) => c.remove), false);
  }
});

test("full storage/DB pages are not mistaken for completed cleanup", async () => {
  const client = fakeClient({ queued: Array.from({ length: 100 }, (_, i) => ({ storage_path: `sexytw/${i}.jpg`, can_delete: true })) });
  assert.equal((await finalizeSnapshot(client, body, now)).complete, false);
  const anotherPage = fakeClient({ page: { scanComplete: false, nextCursor: "00000000-0000-0000-0000-000000000001" } });
  assert.equal((await finalizeSnapshot(anotherPage, body, now)).complete, false);
});

test("queue acknowledgement failure is reported, not silently marked complete", async () => {
  const client = fakeClient({ queued: [{ storage_path: "sexytw/a.jpg", can_delete: true }], ackError: { message: "test" } });
  await assert.rejects(finalizeSnapshot(client, body, now));
});

test("cleanup follows cursor batches beyond 1,000 without an offset or early stop", async () => {
  let pass = 0;
  const totals = await finishSnapshot(async (request) => {
    assert.equal(request.cleanupCursor, pass === 0 ? null : String(pass));
    pass += 1;
    return { ok: true, cleanup: { deleted: pass <= 10 ? 100 : 5, imagesDeleted: 0, seenTouched: pass === 1 ? 2252 : 0,
      nextCursor: String(pass), scanComplete: pass === 11, complete: pass === 11 } };
  }, body);
  assert.equal(pass, 11);
  assert.equal(totals.deleted, 1005);
  assert.equal(totals.seenTouched, 2252);
});

test("cleanup rejects a stuck cursor and a failed page", async () => {
  await assert.rejects(finishSnapshot(async () => ({ ok: true, cleanup: { nextCursor: null, scanComplete: false, complete: false } }), body));
  await assert.rejects(finishSnapshot(async () => ({ ok: false }), body));
});
