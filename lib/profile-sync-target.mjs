export const syncTarget = Object.freeze({
  endpoint: "https://sexytw.cc/api/profile-sync",
  siteUrl: "https://sexytw.cc",
  supabaseUrl: "https://lsxrpubpbnshlqnnddgu.supabase.co",
  schema: "public",
  mediaPrefix: "sexytw",
});

export function assertSyncEndpoint(endpoint) {
  // Validate before sending the bearer token or any profile data. Do not follow
  // redirects: a valid-looking endpoint must not forward a secret elsewhere.
  if (endpoint !== syncTarget.endpoint) throw new Error("Sync endpoint must be the dedicated sexytw.cc endpoint.");
  return endpoint;
}

export function assertSyncEnvironment(env) {
  for (const [key, expected] of [
    ["SITE_URL", syncTarget.siteUrl],
    ["NEXT_PUBLIC_SITE_URL", syncTarget.siteUrl],
    ["NEXT_PUBLIC_SUPABASE_URL", syncTarget.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_SCHEMA", syncTarget.schema],
    ["NEXT_PUBLIC_MEDIA_PREFIX", syncTarget.mediaPrefix],
  ]) {
    if (env[key]?.replace(/\/$/, "") !== expected) throw new Error("Sync target configuration mismatch.");
  }
}

export async function verifySyncTarget(endpoint, secret, fetcher = fetch) {
  assertSyncEndpoint(endpoint);
  if (!secret?.trim()) throw new Error("PROFILE_SYNC_SECRET is missing.");
  const response = await fetcher(endpoint, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { Accept: "application/json", Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`Sync target verification failed (HTTP ${response.status}).`);
  const result = await response.json();
  if (result.ok !== true || result.databaseReachable !== true
    || !Object.entries(syncTarget).every(([key, value]) => result.target?.[key] === value)) {
    throw new Error("Sync target identity mismatch; no profiles were sent.");
  }
  return result;
}
