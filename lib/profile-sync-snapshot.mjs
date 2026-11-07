const MAX_KEYS = 50000;

export function validateSnapshotProof(proof, sourceKeys, capturedAt, now = Date.now()) {
  const keys = Array.isArray(sourceKeys) ? sourceKeys : [];
  const timestamp = Date.parse(capturedAt || "");
  if (!proof || proof.complete !== true || !keys.length || keys.length > MAX_KEYS
    || keys.some((key) => typeof key !== "string" || !/^[0-9]{1,80}$/.test(key))
    || new Set(keys).size !== keys.length
    || proof.sourceTotal !== keys.length || proof.rawCount !== keys.length
    || !Number.isInteger(proof.sourcePages) || proof.sourcePages < 1
    || proof.sourcePages !== Math.ceil(keys.length / 100)
    || proof.pagesFetched !== proof.sourcePages
    || !Number.isFinite(timestamp) || timestamp < now - 8 * 3600000 || timestamp > now + 300000) {
    throw new Error("Complete, recent and unique source snapshot required; cleanup refused.");
  }
  return keys;
}

// Keep manual review decisions and generated content current, but do not
// rewrite identical biographies/SEO or change their public updated_at.
export function changedFields(current, desired) {
  return Object.fromEntries(Object.entries(desired).filter(([key, value]) => current[key] !== value));
}

export async function finishSnapshot(postPayload, payload, { pause = async () => {}, onPage = () => {} } = {}) {
  const totals = { deleted: 0, imagesDeleted: 0, imagesRetained: 0, seenTouched: 0 };
  let cleanupCursor = null;
  for (let pass = 0; pass < 2000; pass += 1) {
    const response = await postPayload({ ...payload, cleanupCursor });
    const page = response?.cleanup;
    if (response?.ok !== true || typeof page?.complete !== "boolean") throw new Error("Final snapshot cleanup failed.");
    for (const key of Object.keys(totals)) totals[key] += page[key] || 0;
    onPage(pass + 1, page);
    if (page.complete) return totals;
    if (page.scanComplete === false && page.nextCursor === cleanupCursor) throw new Error("Cleanup cursor did not advance.");
    cleanupCursor = page.nextCursor;
    await pause();
  }
  throw new Error("Cleanup safety limit reached; remaining media is queued for retry.");
}

export async function finalizeSnapshot(client, body, now = Date.now()) {
  const keys = validateSnapshotProof(body.snapshotProof, body.snapshotSourceKeys, body.capturedAt, now);
  const cursor = body.cleanupCursor ?? null;
  if (cursor !== null && (typeof cursor !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor))) {
    throw new Error("Invalid cleanup cursor.");
  }
  const { data: page, error } = await client.rpc("sexytw_finalize_profile_batch", {
    p_seen_keys: keys, p_captured_at: body.capturedAt, p_after_id: cursor,
  });
  if (error) throw new Error(`Snapshot database cleanup failed: ${error.message}`);
  if (!page || typeof page.scanComplete !== "boolean") throw new Error("Invalid snapshot cleanup response.");

  // The DB transaction queues only paths belonging to deleted imported rows.
  // Storage is a separate service: preserve this tiny retry queue on failure.
  const { data: queued, error: queueError } = await client.rpc("sexytw_media_cleanup_batch");
  if (queueError) throw new Error(`Media reference check failed: ${queueError.message}`);
  const rows = queued ?? [];
  if (!Array.isArray(rows) || rows.some((row) => typeof row.storage_path !== "string"
    || !row.storage_path.startsWith("sexytw/") || /[\\?#]|%(?:2e|2f|5c)/i.test(row.storage_path)
    || row.storage_path.split("/").some((part) => ["", ".", ".."].includes(part)))) {
    throw new Error("Unsafe media cleanup response; no files removed.");
  }
  const deletable = rows.filter((row) => row.can_delete === true).map((row) => row.storage_path);
  if (deletable.length) {
    const { error: storageError } = await client.storage.from("site-media").remove(deletable);
    if (storageError) throw new Error(`Media deletion failed; queued for retry: ${storageError.message}`);
  }
  if (rows.length) {
    const { error: ackError } = await client.from("sexytw_media_cleanup_queue")
      .delete().in("storage_path", rows.map((row) => row.storage_path));
    if (ackError) throw new Error(`Media cleanup acknowledgement failed: ${ackError.message}`);
  }
  // A full batch may have successors. An additional empty pass is cheap and
  // avoids relying on a potentially stale count of queued objects.
  return { ...page, imagesDeleted: deletable.length, imagesRetained: rows.length - deletable.length,
    complete: page.scanComplete && rows.length < 100 };
}
