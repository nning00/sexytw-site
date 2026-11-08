import test from "node:test";
import assert from "node:assert/strict";
import { queryHomeArticleCards, homeCardFields } from "../lib/home-article-cards.mjs";
import { publicReadOnce, withPublicReadScope } from "../lib/public-read-scope.mjs";
import { unstable_cache, revalidateTag } from "vinext/shims/cache";

test("request sharing retains framework tag invalidation between renders", async () => {
  let reads=0;
  const cached=unstable_cache(async()=>++reads,["home-performance-test-only"],{revalidate:300,tags:["home-performance-test-only"]});
  const render=()=>withPublicReadScope(()=>publicReadOnce("cms_settings",cached));
  assert.equal((await render()).response,1);
  assert.equal((await render()).response,1);
  revalidateTag("home-performance-test-only", {expire:0});
  assert.equal((await render()).response,2);
});

test("concurrent reads share a promise only inside one render", async () => {
  let calls = 0;
  const read = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { value: calls }; };
  const result = await withPublicReadScope(async () => {
    const [a,b] = await Promise.all([publicReadOnce("cms_settings", read), publicReadOnce("cms_settings", read)]);
    assert.strictEqual(a,b);
    return new Response("ok");
  });
  assert.equal(calls, 1);
  assert.match(result.serverTiming, /cms_settings;dur=\d+\.\d/);
  await Promise.all([withPublicReadScope(()=>publicReadOnce("cms_settings", read)), withPublicReadScope(()=>publicReadOnce("cms_settings", read))]);
  assert.equal(calls, 3);
  await publicReadOnce("cms_settings", read);
  await publicReadOnce("cms_settings", read);
  assert.equal(calls, 5);
});

test("failed reads can retry, unknown names are not shared or exposed", async () => {
  let calls = 0;
  const result = await withPublicReadScope(async () => {
    await assert.rejects(publicReadOnce("cms_settings", async()=>{ throw new Error("private-error-test"); }));
    assert.equal(await publicReadOnce("cms_settings", async()=>42), 42);
    await publicReadOnce("private-error-test", async()=>calls++);
    await publicReadOnce("private-error-test", async()=>calls++);
    return new Response("ok");
  });
  assert.equal(calls,2);
  assert.doesNotMatch(result.serverTiming,/private-error/);
});

function fakeClient(responses) {
  const queries = [];
  return { queries, from(table) {
    const operations = [["from",table]];
    queries.push(operations);
    const chain = { then(resolve,reject) { return Promise.resolve(responses.shift()).then(resolve,reject); } };
    for(const method of ["select","eq","order","limit"]) chain[method] = (...args) => {operations.push([method,...args]);return chain;};
    return chain;
  }};
}

test("featured query is bounded, thin, published and keeps ordering", async () => {
  const db = fakeClient([{data:[{id:"a"}],error:null}]);
  assert.deepEqual(await queryHomeArticleCards(db),[{id:"a"}]);
  assert.equal(db.queries.length,1);
  assert.doesNotMatch(homeCardFields,/\bcontent\b|seo_|article_images/);
  assert.deepEqual(db.queries[0].filter(x=>x[0]==="eq"),[["eq","status","published"],["eq","is_featured",true]]);
  assert.deepEqual(db.queries[0].filter(x=>x[0]==="order").map(x=>x[1]),["featured_order","sort_order","published_at"]);
  assert.deepEqual(db.queries[0].at(-1),["limit",3]);
});

test("fallback is used only when zero featured articles; query errors do not cache empty content", async () => {
  const db = fakeClient([{data:[],error:null},{data:[{id:"fallback"}],error:null}]);
  assert.deepEqual(await queryHomeArticleCards(db),[{id:"fallback"}]);
  assert.equal(db.queries.length,2);
  assert.deepEqual(db.queries[1].filter(x=>x[0]==="eq"),[["eq","status","published"]]);
  assert.deepEqual(db.queries[1].at(-1),["limit",3]);
  await assert.rejects(queryHomeArticleCards(fakeClient([{error:{message:"sensitive"}}])), /card query failed/);
  await assert.rejects(queryHomeArticleCards(fakeClient([{data:[],error:null},{error:{message:"sensitive"}}])), /fallback failed/);
});
