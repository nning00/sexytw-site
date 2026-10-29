import handler from "vinext/server/fetch-handler";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === "www.sexytw.cc") {
      requestUrl.hostname = "sexytw.cc";
      return Response.redirect(requestUrl.toString(), 308);
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
