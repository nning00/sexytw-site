import test from "node:test";
import assert from "node:assert/strict";
import { dispatchProfileSync, dispatchTarget, syncSlotStart, safeDispatchFailure } from "../lib/profile-sync-dispatch.mjs";
import { syncTarget } from "../lib/profile-sync-target.mjs";

const environment = {
  SITE_URL: syncTarget.siteUrl, NEXT_PUBLIC_SITE_URL: syncTarget.siteUrl,
  NEXT_PUBLIC_SUPABASE_URL: syncTarget.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_SCHEMA: "public", NEXT_PUBLIC_MEDIA_PREFIX: "sexytw",
  GITHUB_ACTIONS_DISPATCH_TOKEN: "test-only-not-a-real-token",
};
const time = Date.parse("2026-11-07T04:17:00Z");
const run = (extra = {}) => ({
  id: 1, head_branch: "main", repository: { full_name: "nning00/sexytw-site" },
  status: "completed", conclusion: "success", created_at: "2026-11-07T03:00:00Z", ...extra,
});

test("six-hour slots match all four Taiwan trigger times", () => {
  for (const utc of ["2026-11-06T16:17:00Z", "2026-11-06T22:17:00Z", "2026-11-07T04:17:00Z", "2026-11-07T10:17:00Z"]) {
    assert.equal(syncSlotStart(Date.parse(utc)), Date.parse(utc));
    assert.equal(syncSlotStart(Date.parse(utc) + 5000), Date.parse(utc));
    assert.equal(syncSlotStart(Date.parse(utc) - 1), Date.parse(utc) - 21600000);
  }
  for (const value of [NaN, Infinity, 0, undefined]) assert.throws(() => syncSlotStart(value));
});

test("refuses wrong site, project, missing token and invalid time before any request", async () => {
  for (const env of [
    { ...environment, GITHUB_ACTIONS_DISPATCH_TOKEN: "" },
    { ...environment, SITE_URL: "https://sexy00.cc" },
    { ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
  ]) {
    let called = false;
    await assert.rejects(dispatchProfileSync(env, time, () => { called = true; throw new Error("must not fetch"); }));
    assert.equal(called, false);
  }
  let called = false;
  await assert.rejects(dispatchProfileSync(environment, NaN, () => { called = true; throw new Error("must not fetch"); }));
  assert.equal(called, false);
});

test("dispatch is fixed to sexytw main only, bearer stays at GitHub and redirects fail closed", async () => {
  const calls = [];
  const result = await dispatchProfileSync(environment, time, async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${environment.GITHUB_ACTIONS_DISPATCH_TOKEN}`);
    return options.method === "POST" ? new Response(null, { status: 204 }) : Response.json({ workflow_runs: [run()] });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.github.com/repos/nning00/sexytw-site/actions/workflows/profile-sync.yml/runs?branch=main&per_page=100");
  assert.equal(calls[1].url, "https://api.github.com/repos/nning00/sexytw-site/actions/workflows/profile-sync.yml/dispatches");
  assert.deepEqual(JSON.parse(calls[1].options.body), { ref: "main" });
  assert.equal(result.status, "dispatched");
  assert.equal(JSON.stringify(result).includes(environment.GITHUB_ACTIONS_DISPATCH_TOKEN), false);
  assert.equal(dispatchTarget.cron, "17 4,10,16,22 * * *");
});

test("active runs and any already-triggered run in the same slot are not dispatched twice", async () => {
  for (const current of [run({ status: "queued" }), run({ status: "in_progress" }), run({ created_at: new Date(time).toISOString(), conclusion: "failure" })]) {
    let count = 0;
    const result = await dispatchProfileSync(environment, time, async () => {
      count++; return Response.json({ workflow_runs: [current] });
    });
    assert.equal(count, 1);
    assert.match(result.status, /^skipped-/);
    assert.equal(result.runId, 1);
  }
});

test("unreadable or cross-repo history must never cause a dispatch", async () => {
  for (const response of [
    new Response("denied", { status: 403 }), Response.json({}),
    Response.json({ workflow_runs: [run({ repository: { full_name: "nning00/sexy00-profile-sync" } })] }),
    Response.json({ workflow_runs: [run({ head_branch: "other" })] }),
    Response.json({ workflow_runs: [run({ created_at: "invalid" })] }),
  ]) {
    let count = 0;
    await assert.rejects(dispatchProfileSync(environment, time, async () => { count++; return response; }));
    assert.equal(count, 1);
  }
});

test("failed dispatch is surfaced without a blind POST retry or response body leak", async () => {
  let count = 0;
  await assert.rejects(dispatchProfileSync(environment, time, async () => {
    count++;
    return count === 1 ? Response.json({ workflow_runs: [] }) : new Response("private upstream body", { status: 403 });
  }), { message: "GitHub sync dispatch failed (HTTP 403)." });
  assert.equal(count, 2);
});

test("diagnostic output includes fixed reasons only, never raw error details", () => {
  for (const message of ["GitHub sync history check failed (HTTP 403).", "GITHUB_ACTIONS_DISPATCH_TOKEN is missing.", "Sync target configuration mismatch."]) {
    assert.equal(safeDispatchFailure(new Error(message)), message);
  }
  for (const value of [new Error("Authorization: Bearer private-test-value"), new Error("GitHub sync dispatch failed (HTTP 403). private-test-value"), { message: "private-test-value" }, null]) {
    assert.equal(safeDispatchFailure(value), "Unexpected upstream/network failure.");
  }
});
