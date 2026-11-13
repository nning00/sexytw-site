import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoveryMode,syncBatchPayload,shouldFinalize} from '../lib/profile-sync-recovery.mjs';
const base={commit:true,selectedCity:null,limit:0,errors:0,warnings:0,upsertOnly:false};
test('normal successful full sync retains existing behavior',()=>assert.equal(shouldFinalize(base),true));
test('recovery never finalizes any result',()=>{for(const errors of [0,1])for(const warnings of [0,1])assert.equal(shouldFinalize({...base,errors,warnings,upsertOnly:true}),false)});
test('partial preview and failures do not finalize',()=>{for(const v of [{commit:false},{selectedCity:'x'},{limit:1},{errors:1},{warnings:1}])assert.equal(shouldFinalize({...base,...v}),false)});
test('recovery refreshes caches and seen times using existing API contract',()=>{const x=syncBatchPayload({commit:true,capturedAt:'2026-11-12T00:00:00Z',profiles:[],upsertOnly:true});assert.equal(x.deferRevalidation,false);assert.equal(x.finalizeSnapshot,undefined);assert.equal(x.mode,'commit')});
test('normal mode still defers',()=>assert.equal(syncBatchPayload({upsertOnly:false}).deferRevalidation,true));
test('mode explicit and workflow opted in',()=>{assert.equal(recoveryMode([]),false);assert.equal(recoveryMode(['--create-only']),true);assert.match(readFileSync('.github/workflows/profile-sync.yml','utf8'),/--commit --create-only/)});
test('runner uses tested functions and lowers concurrency',()=>{const s=readFileSync('scripts/edc-profile-sync.mjs','utf8');assert.match(s,/postPayload\(syncBatchPayload/);assert.match(s,/if \(shouldFinalize/);assert.match(s,/upsertOnly \? 1 : 3/)});

test('create-only is one attempt and counts actual writes',()=>{const s=readFileSync('scripts/edc-profile-sync.mjs','utf8');assert.match(s,/maxAttempts = upsertOnly \? 1 : 3/);assert.match(s,/response\?\.result\?\.created/);});
