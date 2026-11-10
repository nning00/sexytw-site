import handler from "vinext/server/fetch-handler";
import { getOriginalFetch } from "vinext/shims/fetch-cache";
import { applyPublicCanonical } from "../lib/public-canonical.mjs";
import { dispatchProfileSync, safeDispatchFailure } from "../lib/profile-sync-dispatch.mjs";
import { withPublicReadScope } from "../lib/public-read-scope.mjs";

const worker = {
  async scheduled(controller: ScheduledController, env: Cloudflare.Env) {
    let stage = "initialize";
    try {
      // Scheduled events are not page renders: bypass the framework's
      // request-scoped fetch wrapper for these privileged infrastructure calls.
      const result = await dispatchProfileSync(env, controller.scheduledTime, getOriginalFetch(), (value) => { stage = value; });
      console.log(JSON.stringify({ event: "sexytw-sync-scheduler", scheduledAt: new Date(controller.scheduledTime).toISOString(), ...result }));
    } catch (error) {
      // Do not log credentials, request headers or raw upstream exceptions.
      console.error(JSON.stringify({ event: "sexytw-sync-scheduler", status: "failed", stage, reason: safeDispatchFailure(error) }));
      throw new Error("sexytw-sync-scheduler failed");
    }
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const requestUrl = new URL(request.url);
    let redirect = false;
    if (requestUrl.protocol === "http:") {
      requestUrl.protocol = "https:";
      redirect = true;
    }
    if (requestUrl.hostname === "www.sexytw.cc") {
      requestUrl.hostname = "sexytw.cc";
      redirect = true;
    }
    if (redirect) {
      return Response.redirect(requestUrl.toString(), 308);
    }

    const publicHome = request.method === "GET" && requestUrl.pathname === "/";
    const rendered = publicHome
      ? await withPublicReadScope(() => handler.fetch(request, env, ctx))
      : { response: await handler.fetch(request, env, ctx), serverTiming: "" };
    const response = rendered.response;
    const securedResponse = new Response(response.body, response);
    // Aggregate timings only; no query text, identifiers, credentials or user data.
    if (rendered.serverTiming && !request.headers.has("authorization") && !request.headers.has("cookie") && response.ok) {
      securedResponse.headers.append("Server-Timing", rendered.serverTiming);
    }
    if (requestUrl.protocol === "https:") {
      securedResponse.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    securedResponse.headers.set("X-Content-Type-Options", "nosniff");
    securedResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    applyPublicCanonical(request, requestUrl, securedResponse);
    return securedResponse;
  },
};

export default worker;
