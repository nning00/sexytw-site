import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertPresenceCapability} from '../lib/presence-capability.mjs';
import {verifySyncTarget,syncTarget} from '../lib/profile-sync-target.mjs';
for(const [label,fields,allowed] of [
 ['OFF',{presenceVersion:0,presenceSchemaReady:false},false],
 ['ON schema absent',{presenceVersion:0,presenceSchemaReady:false},false],
 ['ON schema verified',{presenceVersion:3,presenceSchemaReady:true},true],
 ['spoofed version only',{presenceVersion:3,presenceSchemaReady:false},false]
]) test(label+' gates writes',async()=>{
 const methods=[];let writes=0;
 const preflight=async()=>{
  const result=await verifySyncTarget(syncTarget.endpoint,'test-secret',async(_url,options)=>{
   methods.push(options.method);return {ok:true,json:async()=>({ok:true,databaseReachable:true,snapshotCleanupVersion:2,createOnlyVersion:1,target:syncTarget,...fields})};
  });
  assertPresenceCapability(result,true);writes++;
 };
 if(allowed)await preflight();else await assert.rejects(preflight,/Presence v3/);
 assert.deepEqual(methods,['GET']);assert.equal(writes,allowed?1:0);
});
test('OFF create-only remains available',()=>assert.doesNotThrow(()=>assertPresenceCapability({},false)));
test('CLI checks capability before crawling or any batch post',()=>{
 const s=readFileSync(new URL('./edc-profile-sync.mjs',import.meta.url),'utf8');
 assert(s.indexOf('assertPresenceCapability(verifiedTarget, presenceV3)')<s.indexOf('const catalogue = await collectProfiles'));
});
test('route exposes only capability, probes are SELECT-only',()=>{
 const s=readFileSync(new URL('../app/api/profile-sync/route.ts',import.meta.url),'utf8');
 const get=s.slice(s.indexOf('export async function GET'),s.indexOf('export async function POST'));
 assert(get.includes('process.env.PROFILE_LIFECYCLE_V3 === "1"'));
 assert(get.includes('.select("source_missing_at").limit(1)'));
 assert(get.includes('.rpc("sexytw_pending_removal_review").limit(1)'));
 assert(get.includes('presenceVersion, presenceSchemaReady, target: syncTarget'));
});
