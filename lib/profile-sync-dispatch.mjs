import { assertSyncEnvironment } from "./profile-sync-target.mjs";

// Fixed destinations: never take a repository, workflow or API origin from a
// request or environment variable. This token must not be sent to another site.
export const dispatchTarget = Object.freeze({
  repository: "nning00/sexytw-site",
  workflow: "profile-sync.yml",
  ref: "main",
  cron: "17 4,10,16,22 * * *",
});
const workflowUrl = "https://api.github.com/repos/nning00/sexytw-site/actions/workflows/profile-sync.yml";
const interval = 6 * 60 * 60 * 1000;
const anchor = Date.UTC(1970, 0, 1, 4, 17);

export function safeDispatchFailure(error) {
  // Only our fixed messages/status codes are safe to log. Fetch exceptions and
  // arbitrary upstream response bodies can contain private request details.
  const message = error && typeof error === "object" && typeof error.message === "string" ? error.message : "";
  if (/^(?:GitHub sync (?:history check|dispatch) failed \(HTTP [0-9]{3}\)\.|GITHUB_ACTIONS_DISPATCH_TOKEN is missing\.|Sync target configuration mismatch\.|Invalid sync schedule time\.|Invalid GitHub sync history response\.|GitHub sync history identity mismatch\.)$/.test(message)) return message;
  // Categories are constant strings, not excerpts from the original message.
  if (/illegal invocation|incorrect.*this|this.*reference/i.test(message)) return "Invalid fetch receiver.";
  if (/cache|request context|request scope|outside.*request/i.test(message)) return "Fetch request-context failure.";
  if (/timeout|timed out/i.test(message)) return "Upstream request timeout.";
  if (/json|unexpected token/i.test(message)) return "Invalid upstream JSON.";
  if (/replace.*function|trim.*function|undefined|null/i.test(message)) return "Invalid scheduler runtime binding.";
  return "Unexpected upstream/network failure.";
}

export function syncSlotStart(time) {
  if (!Number.isFinite(time) || time <= 0) throw new Error("Invalid sync schedule time.");
  return anchor + Math.floor((time - anchor) / interval) * interval;
}

/** @param {{GITHUB_ACTIONS_DISPATCH_TOKEN?: string,
 * SITE_URL?: string, NEXT_PUBLIC_SITE_URL?: string,
 * NEXT_PUBLIC_SUPABASE_URL?: string, NEXT_PUBLIC_SUPABASE_SCHEMA?: string,
 * NEXT_PUBLIC_MEDIA_PREFIX?: string}} env
 * @param {number} scheduledTime
 * @param {typeof fetch} fetcher
 * @param {(stage: string) => void} onStage */
export async function dispatchProfileSync(env, scheduledTime, fetcher = fetch, onStage = () => {}) {
  onStage("environment-check");
  assertSyncEnvironment(env);
  onStage("secret-check");
  const token = env.GITHUB_ACTIONS_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_ACTIONS_DISPATCH_TOKEN is missing.");
  onStage("schedule-check");
  const slotStart = syncSlotStart(scheduledTime);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sexytw-site-scheduler",
  };
  const options = { headers, cache: /** @type {const} */ ("no-store"), redirect: /** @type {const} */ ("error"), signal: AbortSignal.timeout(30000) };
  onStage("history-request");
  const response = await fetcher(`${workflowUrl}/runs?branch=main&per_page=100`, options);
  if (!response.ok) throw new Error(`GitHub sync history check failed (HTTP ${response.status}).`);
  onStage("history-response");
  const history = await response.json();
  if (!Array.isArray(history.workflow_runs)) throw new Error("Invalid GitHub sync history response.");
  for (const run of history.workflow_runs) {
    if (run.head_branch !== "main" || run.repository?.full_name !== dispatchTarget.repository
      || typeof run.status !== "string" || !Number.isFinite(Date.parse(run.created_at))) {
      throw new Error("GitHub sync history identity mismatch.");
    }
  }
  // These reads reduce duplicates; the workflow concurrency group separately
  // prevents overlapping database writes. GitHub's API is not an atomic lock.
  const active = history.workflow_runs.find((run) => run.status !== "completed");
  if (active) return { status: "skipped-active", runId: active.id };
  const existing = history.workflow_runs.find((run) => Date.parse(run.created_at) >= slotStart);
  if (existing) return { status: "skipped-existing-slot", runId: existing.id, conclusion: existing.conclusion };

  onStage("dispatch-request");
  const dispatched = await fetcher(`${workflowUrl}/dispatches`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: dispatchTarget.ref }),
  });
  // Do not retry an ambiguous POST: GitHub may have accepted it even if the
  // response was lost. A later invocation checks history again before sending.
  if (dispatched.status !== 204) throw new Error(`GitHub sync dispatch failed (HTTP ${dispatched.status}).`);
  return { status: "dispatched", repository: dispatchTarget.repository, slot: new Date(slotStart).toISOString() };
}
