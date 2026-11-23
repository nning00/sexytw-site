import { AsyncLocalStorage } from "node:async_hooks";

// Shared by the Worker's RSC/SSR module environments, never between requests.
const scopeKey = Symbol.for("sexytw.public-read-scope.v1");
/** @type {AsyncLocalStorage<{reads: Map<string, Promise<unknown>>, timings: Map<string, number>}>} */
const scope = globalThis[scopeKey] ??= new AsyncLocalStorage();
const metricNames = new Set(["cms_settings", "cms_navigation", "cms_home_articles", "cms_article_cards", "cms_article_categories"]);
const metricFor = name => metricNames.has(name) ? name
  : name.startsWith("profiles:city-location:") ? "cms_city_location"
  : name.startsWith("profiles:city-page:") ? "cms_city_profiles"
  : name.startsWith("articles:detail:") ? "cms_article_detail"
  : name.startsWith("articles:cards:") ? "cms_article_cards" : null;

/** Only public GET renders opt in; actions, admin and sync retain their behavior. */
export async function withPublicReadScope(render) {
  const state = { reads: new Map(), timings: new Map() };
  const started = performance.now();
  // Log once only while headers are still pending. This neither cancels reads
  // nor extends their lifetime; ordinary renders clear the timer immediately.
  const slowTimer = setTimeout(() => {
    console.warn(JSON.stringify({
      event: "sexytw-home-slow-stage",
      elapsedMs: Math.round(performance.now() - started),
      pending: [...new Set([...state.reads.keys()].filter(name => metricFor(name) && !state.timings.has(name)).map(metricFor))],
      completed: Object.fromEntries([...state.timings].filter(([name]) => metricFor(name)).map(([name, ms]) => [metricFor(name), Math.round(ms)])),
    }));
  }, 10000);
  let response;
  try {
    response = await scope.run(state, render);
  } finally {
    clearTimeout(slowTimer);
  }
  const timings = [`app_headers;dur=${(performance.now() - started).toFixed(1)}`];
  for (const [name, duration] of state.timings) {
    const metric = metricFor(name);
    if (metric) timings.push(`${metric};dur=${duration.toFixed(1)}`);
  }
  return { response, serverTiming: timings.join(", ") };
}

/** Request-local promise sharing, not a persistent cache or a cross-user store. */
export function publicReadOnce(name, read) {
  const state = scope.getStore();
  if (!state || (!metricNames.has(name) && !name.startsWith("profiles:") && !name.startsWith("articles:detail:") && !name.startsWith("articles:cards:"))) return read();
  const existing = state.reads.get(name);
  if (existing) return existing;
  const started = performance.now();
  const pending = Promise.resolve().then(read).then(value => {
    state.timings.set(name, performance.now() - started);
    return value;
  }, error => {
    state.reads.delete(name);
    throw error;
  });
  state.reads.set(name, pending);
  return pending;
}
