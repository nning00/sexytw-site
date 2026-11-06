import handler from "vinext/server/fetch-handler";
import { dispatchProfileSync } from "../lib/profile-sync-dispatch.mjs";

const worker = {
  async scheduled(controller: ScheduledController, env: Cloudflare.Env) {
    try {
      const result = await dispatchProfileSync(env, controller.scheduledTime);
      console.log(JSON.stringify({ event: "sexytw-sync-scheduler", scheduledAt: new Date(controller.scheduledTime).toISOString(), ...result }));
    } catch {
      // Do not log credentials, request headers or raw upstream exceptions.
      console.error("sexytw-sync-scheduler failed; check GitHub Actions access and token expiration.");
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

    const response = await handler.fetch(request, env, ctx);
    const securedResponse = new Response(response.body, response);
    if (requestUrl.protocol === "https:") {
      securedResponse.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    securedResponse.headers.set("X-Content-Type-Options", "nosniff");
    securedResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return securedResponse;
  },
};

export default worker;
