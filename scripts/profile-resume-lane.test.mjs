import test from "node:test";
import assert from "node:assert/strict";
import { isResumeRecovery, resumeLaneAdmission, supportedRecoveryHeader, RESUME_CAPTURE_MAX_AGE_MS } from "../lib/profile-resume-lane.mjs";
const now=1700000000000;
const capturedAt=new Date(now).toISOString();
const body={mode:"commit",createOnly:true,deferRevalidation:true,profiles:[{sourceKey:"fixture"}],capturedAt};
test("only exact v2 header opts into new lane",()=>{
  assert.equal(isResumeRecovery("create-only-resume-v2"),true);
  for(const value of [null,"create-only-v1","true","CREATE-ONLY-RESUME-V2"," create-only-resume-v2"])assert.equal(isResumeRecovery(value),false);
});
test("flag is off unless exactly 1",()=>{
  for(const flag of [undefined,null,"","0","true",1])assert.deepEqual(resumeLaneAdmission(flag,body,now),{ok:false,status:409,code:"resume-disabled"});
});
test("scoped create-only request admitted",()=>assert.deepEqual(resumeLaneAdmission("1",body,now),{ok:true,capturedAt}));
test("presence, cleanup, snapshots, preview and batches excluded",()=>{
  for(const modification of [{presenceSnapshot:true},{finalizeSnapshot:true},{snapshotSourceKeys:[]},{snapshotProof:{}},{cleanupCursor:null},{mode:"preview"},{createOnly:false},{deferRevalidation:false},{profiles:[]},{profiles:[{},{}]}]) {
    const res=resumeLaneAdmission("1",{...body,...modification},now);
    assert.equal(res.code,"resume-requires-one-create-only-profile");
  }
});
test("reject invalid, stale and future-dated capture",()=>{
  for(const capturedAt of [undefined,"2023-02-31T00:00:00.000Z","2023-11-14T22:13:20Z",new Date(now-RESUME_CAPTURE_MAX_AGE_MS-1).toISOString(),new Date(now+15001).toISOString()]) {
    assert.equal(resumeLaneAdmission("1",{...body,capturedAt},now).code,"resume-requires-fresh-canonical-capture");
  }
});

test("typos and unrecognized recovery versions do not downgrade",()=>{
  assert.equal(supportedRecoveryHeader(null),true);
  assert.equal(supportedRecoveryHeader("create-only-v1"),true);
  assert.equal(supportedRecoveryHeader("create-only-resume-v2"),true);
  for(const v of ["","CREATE-ONLY-RESUME-V2","create-only-resume-v3","create-only-resume-v","create-only-v1,create-only-resume-v2"])assert.equal(supportedRecoveryHeader(v),false);
});
