import test from "node:test";
import assert from "node:assert/strict";
import { parseRevalidationInput, parseArticleSaveResponse } from "../lib/json-payload.mjs";

test("invalid JSON values normalize without property access failures", () => {
  for(const value of [null,undefined,[],true,1,"text"]) {
    assert.deepEqual(parseRevalidationInput(value),{tags:[],indexNowPaths:[]});
    const response=parseArticleSaveResponse(value);
    assert.equal(response.ok,false);
    assert.equal(typeof response.error,"string");
    assert.deepEqual(response.indexNowPaths,[]);
  }
});
test("only allowed unique cache tags and strings survive", () => {
  assert.deepEqual(parseRevalidationInput({tags:["articles","not-allowed",null,"profiles","articles",123],indexNowPaths:["/articles/example",123,null]}),{
    tags:["articles","profiles"],indexNowPaths:["/articles/example"],
  });
});
test("article success must be true, errors remain strings, paths are filtered", () => {
  assert.deepEqual(parseArticleSaveResponse({ok:true,indexNowPaths:["/articles/test",{},null]}).indexNowPaths,["/articles/test"]);
  assert.equal(parseArticleSaveResponse({ok:"true"}).ok,false);
  assert.equal(parseArticleSaveResponse({error:"登入已失效"}).error,"登入已失效");
  assert.equal(typeof parseArticleSaveResponse({error:{secret:"not-for-display"}}).error,"string");
});
