import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getTrustedResumeStore, getProfileResumeCapability, resumeCreateOnlyProfile } from "../lib/sexytw-profile-resume.mjs";
globalThis.fetch = () => { throw new Error("OFFLINE: no live source/store"); };
const hash = b => createHash("sha256").update(b).digest("hex");
function fixture() {
  const input={provider:"edc-public-catalog",sourceKey:"fixture",capturedAt:new Date().toISOString(),contentHash:"a".repeat(64),cityId:"20000000-0000-0000-0000-000000000001",
    draft:{status:"draft",adult_review_status:"pending",source_provider:"edc-public-catalog",source_key:"fixture"},images:[{url:"https://edc.com.tw/fixture.jpg",alt:"Synthetic"}]};
  const calls=[],counts={downloads:0,puts:0,lookups:0,verifies:0},state={plans:[],proofs:[],objects:new Map(),done:false,beginOverride:null,completeOverride:null,capOverride:null,failAfterPut:false};
  const bytes=new Uint8Array([1,2,3]);
  const store={id:"fixture-immutable-v1",proofVersion:1,immutable:true,validatesImageBytes:true,
    async lookup(plan){counts.lookups++;return state.objects.get(plan.storagePath)??null;},
    async putIfAbsent(plan,b){counts.puts++;assert.equal(hash(b),plan.sha256);assert.equal(state.objects.has(plan.storagePath),false);const proof={storeId:store.id,storagePath:plan.storagePath,sha256:plan.sha256,size:plan.size,contentType:plan.contentType,version:"immutable-fixture-v1",validatedImage:true,immutable:true};state.objects.set(plan.storagePath,proof);if(state.failAfterPut)throw new Error("synthetic lost storage acknowledgement");return proof;},
    async verifyImmutable(proof){counts.verifies++;return {...proof};}};
  const client={async rpc(name,args={}){calls.push({name,args});let data;
    if(name==="sexytw_resume_capability_v2")data=state.capOverride??{version:2,enabled:true,immutableProofVersion:1,immutableProofProvider:store.id};
    else if(name==="sexytw_resume_begin_v2")data=state.beginOverride??(state.done?{outcome:"replayed",published:false}:{operationId:"30000000-0000-0000-0000-000000000001",leaseToken:"fixture-lease",epoch:1,plans:state.plans,proofs:state.proofs});
    else if(name==="sexytw_resume_pin_image_v2"){data={index:args.p_index,url:input.images[args.p_index].url,alt:input.images[args.p_index].alt,sha256:args.p_sha256,size:args.p_size,contentType:args.p_content_type,extension:args.p_extension,storagePath:"sexytw/resume-v2/"+args.p_operation+"/"+args.p_index+"-"+args.p_sha256+"."+args.p_extension};state.plans[args.p_index]=data;}
    else if(name==="sexytw_resume_record_object_v2"){state.proofs[args.p_index]=args.p_proof;data={ok:true};}
    else if(name==="sexytw_resume_complete_v2"){state.done=true;data=state.completeOverride??{outcome:"created",published:false};}
    else throw new Error("unexpected RPC");
    return {data,error:null};
  }};
  const download=async()=>{counts.downloads++;return{bytes,contentType:"image/jpeg",extension:"jpg"};};
  return {input,calls,counts,state,store,client,download,run:()=>resumeCreateOnlyProfile(client,input,download,store)};
}
test("actual checkout has no trusted provider",()=>assert.equal(getTrustedResumeStore(),null));
test("missing store capability performs zero RPC calls",async()=>{const h=fixture();assert.equal(await getProfileResumeCapability(h.client,null),false);assert.equal(h.calls.length,0)});
test("direct resume also rejects missing store before reads/download/writes",async()=>{const h=fixture();await assert.rejects(resumeCreateOnlyProfile(h.client,h.input,h.download,null),/immutable-store-unavailable/);assert.equal(h.calls.length,0);assert.equal(h.counts.downloads,0)});
test("declarative flag without required trusted code methods is insufficient",async()=>{const h=fixture();assert.equal(await getProfileResumeCapability(h.client,{id:h.store.id,immutable:true,proofVersion:1}),false);assert.equal(h.calls.length,0)});
for(const change of [{enabled:false},{version:1},{immutableProofVersion:0},{immutableProofProvider:"other"}])test("capability mismatch fails closed "+JSON.stringify(change),async()=>{const h=fixture();h.state.capOverride={version:2,enabled:true,immutableProofVersion:1,immutableProofProvider:h.store.id,...change};await assert.rejects(h.run(),/capability-unavailable/);assert.equal(h.calls.length,1);assert.equal(h.counts.downloads,0)});
test("RPC exception is unavailable, not permission to proceed",async()=>{const h=fixture();h.client.rpc=async()=>{throw new Error("offline fixture error")};assert.equal(await getProfileResumeCapability(h.client,h.store),false)});
test("new operation pins bytes before a single immutable put then verifies twice",async()=>{const h=fixture();assert.deepEqual(await h.run(),{outcome:"created",published:false});assert.deepEqual(h.counts,{downloads:1,puts:1,lookups:1,verifies:2});assert.equal(h.calls.filter(c=>c.name==="sexytw_resume_complete_v2").length,1);assert.equal(h.calls.filter(c=>c.name==="sexytw_resume_record_object_v2").length,2)});
test("done receipt replay skips all object/download side effects",async()=>{const h=fixture();await h.run();const before={...h.counts};assert.deepEqual(await h.run(),{outcome:"replayed",published:false});assert.deepEqual(h.counts,before)});
test("lost object ack is not retried; a later owned call adopts exact proof without another download",async()=>{const h=fixture();h.state.failAfterPut=true;await assert.rejects(h.run(),/lost storage acknowledgement/);assert.equal(h.counts.puts,1);assert.equal(h.calls.some(c=>c.name==="sexytw_resume_complete_v2"),false);h.state.failAfterPut=false;await h.run();assert.equal(h.counts.puts,1);assert.equal(h.counts.downloads,1)});
test("same URL with different bytes cannot replace an already pinned plan",async()=>{const h=fixture();h.state.plans=[{index:0,url:h.input.images[0].url,alt:"Synthetic",sha256:"c".repeat(64),size:3,contentType:"image/jpeg",extension:"jpg",storagePath:"sexytw/resume-v2/30000000-0000-0000-0000-000000000001/0-c.jpg"}];await assert.rejects(h.run(),/original-bytes-changed/);assert.equal(h.counts.puts,0)});
test("unexpected proof digest blocks DB checkpoint/completion",async()=>{const h=fixture(),put=h.store.putIfAbsent;h.store.putIfAbsent=async(...a)=>({...await put(...a),sha256:"0".repeat(64)});await assert.rejects(h.run(),/object-proof-mismatch/);assert.equal(h.calls.some(c=>c.name==="sexytw_resume_record_object_v2"),false)});
test("changed immutable version on verification refuses completion",async()=>{const h=fixture();h.store.verifyImmutable=async p=>({...p,version:"changed"});await assert.rejects(h.run(),/immutable-version-changed/);assert.equal(h.calls.some(c=>c.name==="sexytw_resume_complete_v2"),false)});
for(const begin of [{outcome:"created",published:true},{outcome:"replayed"},{outcome:"skipped-existing",published:true}])test("strict begin outcome "+JSON.stringify(begin),async()=>{const h=fixture();h.state.beginOverride=begin;await assert.rejects(h.run(),/resume-(invalid|missing)/);assert.equal(h.counts.downloads,0)});
test("ordinary existing profile is skipped without claiming it was published",async()=>{const h=fixture();h.state.beginOverride={outcome:"skipped-existing"};assert.deepEqual(await h.run(),{outcome:"skipped-existing"});assert.equal(h.counts.downloads,0)});
for(const complete of [{outcome:"skipped-existing"},{outcome:"created"},{outcome:"replayed",published:"true"}])test("strict complete receipt "+JSON.stringify(complete),async()=>{const h=fixture();h.state.completeOverride=complete;await assert.rejects(h.run(),/resume-(invalid|missing)/)});
test("stale capture fails before even capability DB read",async()=>{const h=fixture();h.input.capturedAt=new Date(Date.now()-3600001).toISOString();await assert.rejects(h.run(),/stale-capture/);assert.equal(h.calls.length,0)});
test("duplicate image identity is rejected before DB reads",async()=>{const h=fixture();h.input.images.push({...h.input.images[0]});await assert.rejects(h.run(),/invalid-image-count/);assert.equal(h.calls.length,0)});
test("no normal Supabase Storage, deletion, finalizer or write retry is used",async()=>{const h=fixture();h.client.storage=new Proxy({}, {get(){throw new Error("unreviewed normal storage accessed")}});await h.run();assert.equal(h.calls.some(c=>/finaliz|delete|cleanup|archive/.test(c.name)),false);assert.equal(h.counts.puts,1)});
