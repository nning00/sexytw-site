import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readSyncResponse,responseDiagnostic,errorCategories,SafeSyncResponseError,safeFailure,safeBatchSummary} from '../lib/sync-response-diagnostics.mjs';
const source=readFileSync(new URL('./edc-profile-sync.mjs',import.meta.url),'utf8');
const chunkCode=source.slice(source.indexOf('  async function syncChunk('),source.indexOf('  // Three small requests'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const canary='SECRET_CANARY_SQL_URL_NAME_TOKEN';
async function run(body,status=207,media='application/json') {
 const logs=[];let calls=0;
 const console=Object.fromEntries(['log','warn','error'].map(k=>[k,(...v)=>logs.push(v.join(' '))]));
 const fn=new AsyncFunction('postPayload','syncBatchPayload','commit','capturedAt','upsertOnly','chunks','console','responseDiagnostic','errorCategories','SafeSyncResponseError','safeFailure','safeBatchSummary',chunkCode+'; return syncChunk([{}, {}, {}],0);');
 const result=await fn(async(_,options)=>{calls++;return readSyncResponse(new Response(body,{status,headers:{'content-type':media}}),options);}, x=>x,true,'synthetic',true,[[]],console,responseDiagnostic,errorCategories,SafeSyncResponseError,safeFailure,safeBatchSummary);
 return {result,calls,logs:logs.join('\n')};
}
test('207 known/unknown errors: safe categories, full batch fail, one attempt',async()=>{
 const x=await run(JSON.stringify({ok:false,summary:{private:canary},result:{errors:[{sourceKey:canary,message:'incomplete-new-draft-requires-review'},{sourceKey:canary,message:'image-download-404'},{message:canary}]}}),207,`application/json; secret=${canary}`);
 assert.equal(x.result.errors,3);assert.equal(x.calls,1);assert(!x.logs.includes(canary));
 for(const fragment of ['"status":207','"media":"json"','"envelope":"unsuccessful"','"incomplete_draft":1','"image_not_found":1','"unknown":1']) assert(x.logs.includes(fragment));
});
test('207 unknown content-type and SQL text cannot escape',async()=>{
 const x=await run(JSON.stringify({ok:false,result:{errors:[{message:canary},{message:'image-download-404 '+canary},null]}}),207,canary);
 assert.equal(x.result.errors,3);assert(x.logs.includes('"unknown":3'));assert(x.logs.includes('"media":"other"'));assert(!x.logs.includes(canary));
});
test('invalid 2xx nonJSON, scalar, array, missing summary and missing errors fail closed',async()=>{
 for(const body of [canary,'null','[]','{}',JSON.stringify({ok:true,private:canary}),JSON.stringify({ok:true,summary:{},result:{private:canary}})]) {
  const x=await run(body,200);assert.equal(x.result.errors,3);assert.equal(x.calls,1);assert(!x.logs.includes(canary));
 }
});
test('valid success preserves accounting, no raw summary output',async()=>{
 const x=await run(JSON.stringify({ok:true,summary:{unchanged:1,pendingReview:2,skippedCity:0,private:canary},result:{created:2,updated:0,errors:[]}}),200);
 assert.deepEqual(x.result,{create:2,update:0,unchanged:1,pendingReview:2,skippedCity:0,warnings:0,errors:0});assert.equal(x.calls,1);assert(!x.logs.includes(canary));
});
test('HTTP failure and transport exception never output raw data',async()=>{
 const x=await run(JSON.stringify({error:canary}),500);assert.equal(x.result.errors,3);assert(!x.logs.includes(canary));assert.equal(safeFailure(new Error(canary)),'sync-request-failed');
});
test('lifecycle gates and retries remain byte-identical to baseline',()=>{
 const tail=s=>s.slice(s.indexOf('  // Three small requests'));
 assert.equal(createHash('sha256').update(tail(source)).digest('hex'),'5aed94ab62a9b9b405ea347c45986ef6e478bb3ed25e17a88b40a3555bb930ef');
 assert(source.includes('const maxAttempts = upsertOnly ? 1 : 3;'));
 assert(source.includes('totals.errors === 0 && totals.warnings === 0'));
 assert(source.includes('errors:totals.errors,warnings:totals.warnings,upsertOnly'));
});

test('actual scheduler: two partial batches give errors=6 and zero presence/finalizer calls',async()=>{
 const {shouldFinalize,syncBatchPayload}=await import('../lib/profile-sync-recovery.mjs');
 const start=source.indexOf('  const chunks = [];');
 const end=source.lastIndexOf('\n} else {');
 const code=source.slice(start,end);
 let calls=0,finalizers=0;const logs=[];
 const console=Object.fromEntries(['log','warn','error'].map(k=>[k,(...v)=>logs.push(v.join(' '))]));
 const fn=new AsyncFunction('profiles','postPayload','syncBatchPayload','commit','capturedAt','upsertOnly','presenceV3','selectedCity','limit','catalogue','console','responseDiagnostic','errorCategories','SafeSyncResponseError','safeFailure','shouldFinalize','finishSnapshot','setTimeout','safeBatchSummary',code);
 await assert.rejects(fn(Array.from({length:6},()=>({})),async payload=>{
   assert.equal(payload.profiles.length,3);assert(!payload.presenceSnapshot);calls++;
   return readSyncResponse(new Response(JSON.stringify({ok:false,result:{errors:[{message:'incomplete-new-draft-requires-review',sourceKey:canary}]}}),{status:207}));
 },syncBatchPayload,true,'synthetic',true,true,'',0,{},console,responseDiagnostic,errorCategories,SafeSyncResponseError,safeFailure,shouldFinalize,async()=>{finalizers++;},cb=>cb(),safeBatchSummary),/6/);
 assert.equal(calls,2);assert.equal(finalizers,0);assert(!logs.join('\n').includes(canary));
 assert(logs.join('\n').includes('"errors": 6'));
});

test('maintenance transport returns original 2xx/207 payloads, including malformed fallback',async()=>{
 for (const status of [200,207]) for (const value of [null,[],{ok:false,result:{errors:[]}},{ok:true,presence:{complete:true}},{ok:true,cleanup:{done:true}}]) {
  assert.deepEqual(await readSyncResponse(new Response(JSON.stringify(value),{status})),value);
 }
 assert.deepEqual(await readSyncResponse(new Response('not json',{status:200})),{error:'HTTP 200'});
});
test('fixed image categories only; appended sensitive details become unknown',()=>{
 const messages=['image-download-401','image-download-403','image-download-429','image-download-503','image-content-type-invalid','image-size-invalid','New profile requires complete images'];
 const counts=errorCategories(messages.map(message=>({message})));
 for (const key of ['image_unauthorized','image_forbidden','image_rate_limited','image_server_error','image_type_invalid','image_size_invalid','images_incomplete']) assert.equal(counts[key],1);
 assert.equal(errorCategories(messages.map(message=>({message:message+canary}))).unknown,7);
});
test('summary allowlist and transport categories cannot leak inputs',()=>{
 assert.deepEqual(safeBatchSummary({received:3,valid:2,invalid:1,create:0,update:-1,unchanged:1.2,pendingReview:canary,skippedCity:Infinity,private:canary}),{received:3,valid:2,invalid:1,create:0});
 const e=new Error(canary);e.name='TimeoutError';assert.equal(safeFailure(e),'sync-timeout-or-abort');
 assert.equal(safeFailure(new TypeError(canary)),'sync-network-or-request-error');
});
