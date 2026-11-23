import test from 'node:test';
import assert from 'node:assert/strict';
import {withPublicReadScope,publicReadOnce} from '../lib/public-read-scope.mjs';
test('article detail shares metadata/page reads; list limits never collide or leak',async()=>{
  let reads=0;
  const render=()=>withPublicReadScope(async()=>{
    const result=await Promise.all([
      publicReadOnce('articles:detail:fixture-private-slug',()=>++reads),
      publicReadOnce('articles:detail:fixture-private-slug',()=>++reads),
      publicReadOnce('articles:cards:8',()=>++reads),
      publicReadOnce('articles:cards:null',()=>++reads),
    ]);
    assert.equal(result[0],result[1]);assert.notEqual(result[2],result[3]);
    return new Response('ok');
  });
  const first=await render();assert.equal(reads,3);
  assert.match(first.serverTiming,/cms_article_detail;dur=/);assert.match(first.serverTiming,/cms_article_cards;dur=/);
  assert.doesNotMatch(first.serverTiming,/fixture-private-slug|articles:cards/);
  await render();assert.equal(reads,6);
});
