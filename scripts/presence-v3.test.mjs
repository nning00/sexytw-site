import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {reconcilePresence} from '../lib/profile-presence-v3.mjs';
const now=Date.now(),body={capturedAt:new Date(now-1).toISOString(),snapshotSourceKeys:['1'],snapshotProof:{complete:true,sourceTotal:1,rawCount:1,sourcePages:1,pagesFetched:1,importErrors:0,importWarnings:0}};
test('only non destructive RPC called',async()=>{const calls=[];const r=await reconcilePresence({rpc:async(n)=>{calls.push(n);return {data:{complete:true,deleted:0,imagesDeleted:0,hidden:1}};}},body,now);assert.deepEqual(calls,['sexytw_finalize_presence_v3']);assert.equal(r.hidden,1);});
for(const patch of [{complete:false},{importErrors:1},{importWarnings:1},{importErrors:undefined},{rawCount:2}])test('invalid proof '+JSON.stringify(patch),async()=>{let called=false;await assert.rejects(reconcilePresence({rpc:async()=>{called=true;}},{...body,snapshotProof:{...body.snapshotProof,...patch}},now));assert.equal(called,false);});
test('unexpected delete response fails',async()=>{await assert.rejects(reconcilePresence({rpc:async()=>({data:{complete:true,deleted:1,imagesDeleted:0}})},body,now));});
test('route keeps create-only and explicit presence feature gate',()=>{const s=readFileSync(new URL('../app/api/profile-sync/route.ts',import.meta.url),'utf8');assert.ok(s.includes('process.env.PROFILE_LIFECYCLE_V3 !== "1"'));assert.ok(s.includes('Existing profile writes require separately reviewed integration'));assert.ok(s.includes('Legacy cleanup disabled'));});
test('SQL wait is based on subsequent evidence and no automatic delete body',()=>{const sql=readFileSync(new URL('../supabase/presence-v3.review.sql',import.meta.url),'utf8');assert.ok(sql.includes("s.captured_at>=p.source_missing_at+interval '72 hours'"));assert.doesNotMatch(sql,/DELETE\s+FROM/i);});
// Exercise the real CLI batch function and its real presence gate without importing
// the entrypoint (which would load local environment and access the network).
const cli=readFileSync(new URL('./edc-profile-sync.mjs',import.meta.url),'utf8');
const batchCode=cli.slice(cli.indexOf('  async function syncChunk('),cli.indexOf('  // Three small requests'));
const gateStart=cli.indexOf('  if (presenceV3 && commit');
const gateCode=cli.slice(gateStart,cli.indexOf('  if (shouldFinalize(',gateStart));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function exerciseBatch(reply){
  const calls=[];
  const postPayload=async payload=>{calls.push(payload);return payload.presenceSnapshot?{ok:true,presence:{complete:true}}:reply;};
  const run=new AsyncFunction('postPayload',`
    const upsertOnly=true,commit=true,presenceV3=true,capturedAt='2026-11-13T00:00:00Z',chunks=[[{}]],selectedCity='',limit=0;
    const console={log(){},warn(){},error(){}},errorMessage=String;
    const syncBatchPayload=x=>x;
    const catalogue={sourceKeys:['1'],snapshotProof:{complete:true}};
    ${batchCode}
    const totals=await syncChunk(chunks[0],0);
    ${gateCode}
    return totals;
  `);
  return {totals:await run(postPayload),calls};
}
for(const [label,reply] of [
  ['missing summary',{ok:true,result:{errors:[]}}],
  ['missing result',{ok:true,summary:{}}],
  ['ok false without errors',{ok:false,summary:{},result:{errors:[]}}],
  ['missing ok',{summary:{},result:{errors:[]}}],
  ['missing errors',{ok:true,summary:{},result:{}}],
  ['invalid errors',{ok:true,summary:{},result:{errors:{}}}],
  ['empty object',{}],['null',null],
])test('CLI fails closed and never sends presence: '+label,async()=>{
  const {totals,calls}=await exerciseBatch(reply);
  assert.equal(totals.errors,1);assert.equal(calls.length,1);
  assert.equal(calls.some(x=>x.presenceSnapshot),false);
});
test('CLI valid batch reaches presence exactly once',async()=>{
 const {totals,calls}=await exerciseBatch({ok:true,summary:{unchanged:1},result:{errors:[],created:0,updated:0}});
 assert.equal(totals.errors,0);assert.equal(calls.filter(x=>x.presenceSnapshot).length,1);
});
