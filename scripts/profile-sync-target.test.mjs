import test from "node:test";
import assert from "node:assert/strict";
import { assertSyncEndpoint, assertSyncEnvironment, syncTarget, verifySyncTarget } from "../lib/profile-sync-target.mjs";

const environment = {
  SITE_URL: syncTarget.siteUrl,
  NEXT_PUBLIC_SITE_URL: syncTarget.siteUrl,
  NEXT_PUBLIC_SUPABASE_URL: syncTarget.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_SCHEMA: "public",
  NEXT_PUBLIC_MEDIA_PREFIX: "sexytw",
};

test("only the exact sexytw endpoint is accepted", () => {
  assert.equal(assertSyncEndpoint(syncTarget.endpoint), syncTarget.endpoint);
  for (const endpoint of [undefined, "https://sexy00.cc/api/profile-sync", "https://sexyning.cc/api/profile-sync", "https://18ning.cc/api/profile-sync", `${syncTarget.endpoint}?next=other`, "http://sexytw.cc/api/profile-sync", "https://sexytw.cc@evil.example/api/profile-sync"]) {
    assert.throws(() => assertSyncEndpoint(endpoint));
  }
});

test("rejects wrong site, project, schema or image prefix", () => {
  assert.doesNotThrow(() => assertSyncEnvironment(environment));
  for (const key of Object.keys(environment)) {
    assert.throws(() => assertSyncEnvironment({ ...environment, [key]: "wrong-target" }));
    assert.throws(() => assertSyncEnvironment({ ...environment, [key]: undefined }));
  }
});

test("wrong endpoint is rejected before any request or credential transfer", async () => {
  let called = false;
  await assert.rejects(verifySyncTarget("https://sexy00.cc/api/profile-sync", "test-only", async () => { called = true; }));
  assert.equal(called, false);
});

test("preflight is authenticated, read-only, noncached and refuses redirects", async () => {
  await verifySyncTarget(syncTarget.endpoint, "test-only", async (url, options) => {
    assert.equal(url, syncTarget.endpoint);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    assert.equal(options.body, undefined);
    return Response.json({ ok: true, databaseReachable: true, snapshotCleanupVersion: 2, target: syncTarget });
  });
});

test("rejects authentication failures, incomplete identity and wrong database", async () => {
  await assert.rejects(verifySyncTarget(syncTarget.endpoint, "", async () => { throw new Error("must not fetch"); }));
  for (const response of [
    new Response("Unauthorized", { status: 401 }),
    Response.json({ ok: true }),
    Response.json({ ok: true, databaseReachable: true, target: syncTarget }),
    Response.json({ ok: true, databaseReachable: false, target: syncTarget }),
    Response.json({ ok: true, databaseReachable: true, target: { ...syncTarget, supabaseUrl: "https://other.supabase.co" } }),
  ]) {
    await assert.rejects(verifySyncTarget(syncTarget.endpoint, "test-only", async () => response));
  }
});
