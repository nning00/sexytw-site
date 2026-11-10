import assert from "node:assert/strict";
import test from "node:test";
import { applyPublicCanonical } from "../lib/public-canonical.mjs";

const origin = "https://sexytw.cc";
const taipei = "/regions/north/taipei";
const linkFor = (path) => `<${origin}${path}>; rel="canonical"`;
const agents = {
  Chrome: "Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36",
  Googlebot: "Mozilla/5.0 Chrome/142.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1)",
  Twitterbot: "Twitterbot/1.0",
};

for (const [name, agent] of Object.entries(agents)) {
  for (const method of ["GET", "HEAD"]) {
    test(`${name} ${method}: both allowed paths, HIT and MISS, preserve headers and stream`, async () => {
      for (const path of ["/", taipei]) {
        for (const cache of ["HIT", "MISS"]) {
          const url = new URL(path, origin);
          const request = new Request(url, { method, headers: { "User-Agent": agent } });
          const headers = {
            "Content-Type": "text/html; charset=utf-8",
            "X-Vinext-Cache": cache,
            "Cache-Control": "public, s-maxage=300",
            Vary: "RSC, Next-Router-State-Tree",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Server-Timing": "app;dur=25",
          };
          const encoder = new TextEncoder();
          const original = new Response(method === "HEAD" ? null : new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("<html><head></head>"));
              controller.enqueue(encoder.encode("<body>測試</body></html>"));
              controller.close();
            },
          }), { headers });
          const response = new Response(original.body, original);
          const body = response.body;
          applyPublicCanonical(request, url, response);
          assert.equal(response.headers.get("Link"), linkFor(path));
          assert.deepEqual([...response.headers].filter(([name]) => name !== "link"), [...new Headers(headers)]);
          assert.equal(response.status, 200);
          assert.equal(response.body, body);
          assert.equal(response.bodyUsed, false);
          if (method === "HEAD") assert.equal(body, null);
          else {
            const reader = body.getReader();
            const decoder = new TextDecoder();
            assert.equal(decoder.decode((await reader.read()).value), "<html><head></head>");
            assert.equal(decoder.decode((await reader.read()).value), "<body>測試</body></html>");
            assert.equal((await reader.read()).done, true);
          }
        }
      }
    });
  }
}

test("replaces conflicting canonical links without losing other relations or splitting quoted commas", () => {
  const url = new URL("/?utm_source=test", origin);
  const preload = `</assets/font,2.woff2>; rel=preload; title="font, rel=canonical"; as=font`;
  const alternate = `</feed>; rel="alternate"; title="A, B"`;
  const existing = `${preload}, <https://wrong.example/>; REL=CaNoNiCaL, </feed>; rel="canonical alternate"; title="A, B", ${linkFor("/")}`;
  const response = new Response("html", { headers: { "Content-Type": "text/html", Link: existing } });
  const request = new Request(url);
  applyPublicCanonical(request, url, response);
  assert.equal(response.headers.get("Link"), `${preload}, ${alternate}, ${linkFor("/")}`);
  applyPublicCanonical(request, url, response);
  assert.equal(response.headers.get("Link"), `${preload}, ${alternate}, ${linkFor("/")}`);
});

test("preserves noncanonical Link text when appending a declaration", () => {
  const url = new URL(taipei, origin);
  const existing = `</main.js>; rel=preload; title="a; rel=canonical",  </styles.css>; rel=preload`;
  const response = new Response("html", { headers: { "Content-Type": "text/html", Link: existing } });
  applyPublicCanonical(new Request(url), url, response);
  assert.equal(response.headers.get("Link"), `${existing}, ${linkFor(taipei)}`);
});

const exclusions = [
  ["404", "/", {}, 404],
  ["410", taipei, {}, 410],
  ["error", "/", {}, 500],
  ["redirect", "/", {}, 308, { Location: origin }],
  ["304", "/", {}, 304],
  ["partial response", "/", {}, 206],
  ["RSC content type", "/", {}, 200, { "Content-Type": "text/x-component" }],
  ["RSC request", "/", { headers: { RSC: "1" } }, 200],
  ["authorized request", "/", { headers: { Authorization: "Bearer test-fixture" } }, 200],
  ["location response", "/", {}, 200, { Location: origin + taipei }],
  ["unrelated city", "/regions/north/new-taipei", {}, 200],
  ["API", "/api/profile-sync", {}, 200],
  ["admin", "/admin", {}, 200],
  ["asset", "/images/logo.svg", {}, 200],
  ["POST", "/", { method: "POST" }, 200],
  ["preview or alternate origin", "https://test.example/", {}, 200],
  ["HTTP origin", "http://sexytw.cc/", {}, 200],
];

for (const [name, path, options, status, extraHeaders] of exclusions) {
  test(`leaves ${name} untouched`, () => {
    const url = new URL(path, origin);
    const headers = {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
      Link: "</asset>; rel=preload",
      ...extraHeaders,
    };
    const response = new Response(null, { status, headers });
    applyPublicCanonical(new Request(url, options), url, response);
    assert.equal(response.status, status);
    assert.deepEqual([...response.headers], [...new Headers(headers)]);
    assert.equal(response.body, null);
  });
}
