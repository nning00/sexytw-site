import assert from "node:assert/strict";
import test from "node:test";
import { applyArticleCanonical } from "../lib/article-canonical.mjs";

const site = "https://sexytw.cc";
const path = "/articles/advance-vs-same-day-booking-strategy";
const canonical = `<${site}${path}>; rel="canonical"`;

for (const method of ["GET", "HEAD"]) {
  for (const cache of ["MISS", "HIT"]) {
    test(`${method} ${cache} uses the original article URL without tracking parameters`, async () => {
      const url = new URL(path + "?utm_source=fixture", site);
      const response = new Response(method === "GET" ? "article fixture" : null, { headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Vinext-Cache": cache,
        "Cache-Control": "public, s-maxage=300",
        "X-Content-Type-Options": "nosniff",
        Link: '</assets/cover.webp>; rel="preload"; as="image"',
      } });
      const before = new Headers(response.headers);
      const body = response.body;
      applyArticleCanonical(new Request(url, { method }), url, response);
      assert.equal(response.headers.get("Link"), `${before.get("Link")}, ${canonical}`);
      before.set("Link", response.headers.get("Link"));
      assert.deepEqual([...response.headers], [...before]);
      assert.equal(response.body, body);
      assert.equal(response.bodyUsed, false);
      assert.equal(await response.text(), method === "GET" ? "article fixture" : "");
    });
  }
}

test("replaces a conflicting canonical and retains independent preload and alternate links", () => {
  const url = new URL(path, site);
  const preload = '</assets/cover,2.webp>; rel=preload; title="cover, detail"';
  const response = new Response(null, { headers: {
    "Content-Type": "text/html",
    Link: `${preload}, </old>; rel="canonical alternate", ${canonical}`,
  } });
  for (let i = 0; i < 2; i++) applyArticleCanonical(new Request(url), url, response);
  assert.equal(response.headers.get("Link"), `${preload}, </old>; rel="alternate", ${canonical}`);
});

const skip = [
  ["/", 200], ["/regions/north/taipei", 200], ["/articles", 200],
  ["/articles/category/booking-guide", 200], ["/admin/articles/some/edit", 200],
  ["/api/health", 200], ["/articles/feed.xml", 200], [path + "/extra", 200],
  ["https://preview.invalid" + path, 200], ["/articles/qa-test", 404], [path, 410],
  [path, 500], [path, 308, {}, { Location: site + path }], [path, 304],
  [path, 200, { method: "POST" }], [path, 200, { headers: { RSC: "1" } }],
  [path, 200, { headers: { Authorization: "Bearer test-fixture" } }],
  [path, 200, {}, { "Content-Type": "application/json" }],
  [path, 200, {}, { "X-Robots-Tag": "noindex" }],
];
for (const [pathname, status, options = {}, headers = {}] of skip) {
  test(`skips ${pathname} with ${status} ${JSON.stringify(options)} ${JSON.stringify(headers)}`, () => {
    const url = new URL(pathname, site);
    const response = new Response(null, { status, headers: { "Content-Type": "text/html", ...headers } });
    applyArticleCanonical(new Request(url, options), url, response);
    assert.equal(response.headers.has("Link"), false);
  });
}
