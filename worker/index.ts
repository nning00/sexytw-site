import handler from "vinext/server/fetch-handler";

const worker = {
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
