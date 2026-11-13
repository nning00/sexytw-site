import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,appendFileSync} from 'node:fs';
const E=process.env, repo='nning00/sexytw-site', branch='codex/sexytw-same-version-check-20261113', base='b911a1b1c08cc01675ae57bb30691ecfc3ab38f1', target='f423cb8e-eeb7-4ec6-8645-504da3e9f19c', worker='sexytw-site';
const evidence={target,worker,sha:E.GITHUB_SHA,run:E.GITHUB_RUN_ID,attempt:E.GITHUB_RUN_ATTEMPT,mutationAttempted:false};
function save(){writeFileSync('same-version-evidence.json',JSON.stringify(evidence,null,2));}
async function gh(path){const r=await fetch('https://api.github.com/repos/'+repo+'/'+path,{headers:{Authorization:'Bearer '+E.GITHUB_TOKEN,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});assert(r.ok,'GitHub preflight HTTP '+r.status);return r.json();}
function wr(args){return execFileSync(E.WRANGLER_BIN,args,{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe'],env:{...E,CI:'true',WRANGLER_SEND_METRICS:'false'}});}
function live(){const rows=JSON.parse(wr(['deployments','list','--name',worker,'--json']));assert(rows.length>0);const d=rows.sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];assert.equal(d.versions.length,1);assert.equal(d.versions[0].version_id,target);assert.equal(d.versions[0].percentage,100);return {id:d.id,created_on:d.created_on,versions:d.versions};}
async function health(){const a=await fetch('https://sexytw.cc/',{signal:AbortSignal.timeout(25000),redirect:'error'});assert.equal(a.status,200);await a.body.cancel();const b=await fetch('https://sexytw.cc/api/health',{signal:AbortSignal.timeout(25000),redirect:'error'});assert.equal(b.status,200);const j=await b.json();assert.equal(j.ok,true);assert.equal(j.database,'connected');return {homepage:200,health:200,ok:true,database:'connected'};}
async function guard(){
 assert.equal(E.GITHUB_REPOSITORY,repo);assert.equal(E.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(E.GITHUB_REF,'refs/heads/'+branch);assert.equal(E.GITHUB_RUN_ATTEMPT,'1');assert.equal(E.EXPECTED_SHA,E.GITHUB_SHA);assert.equal(E.CLOUDFLARE_ACCOUNT_ID,'f9f173ed7748397ad18c0df63220fc3f');
 assert.equal((await gh('git/ref/heads/main')).object.sha,base);
 assert.equal((await gh('git/ref/heads/'+branch)).object.sha,E.GITHUB_SHA);
 assert.equal((await gh('actions/workflows/profile-sync.yml')).state,'disabled_manually');
 const prior=await gh('actions/workflows/deploy-worker.yml/runs?branch='+encodeURIComponent(branch)+'&event=workflow_dispatch&per_page=100');
 assert.equal(prior.workflow_runs.filter(r=>String(r.id)!==E.GITHUB_RUN_ID).length,0,'One-time branch already used; no retry');
 for(const state of ['in_progress','queued','waiting','pending','requested']) {const r=await gh('actions/runs?status='+state+'&per_page=100');assert.equal(r.workflow_runs.filter(x=>String(x.id)!==E.GITHUB_RUN_ID).length,0,'Other workflow active');}
}
try{
 await guard(); evidence.before=live();evidence.healthBefore=await health();save();
 await guard();assert.equal(live().id,evidence.before.id,'Deployment drift');
 evidence.mutationAttempted=true;save();
 try {wr(['rollback',target,'--name',worker,'--yes','--message','User-approved same-version verification; no code change']);evidence.commandSucceeded=true;}catch(e){evidence.commandSucceeded=false;evidence.commandError='Rollback command failed or uncertain; no retry';}
 evidence.after=live();evidence.healthAfter=await health();save();
 assert.equal(evidence.commandSucceeded,true,'Rollback command failed; inspect evidence, do not rerun');
 assert.notEqual(evidence.after.id,evidence.before.id,'No new rollback deployment observed');
 evidence.result='SAME_VERSION_ROLLBACK_VERIFIED';save();
 console.log(JSON.stringify(evidence,null,2));
}catch(e){evidence.result='FAILED_OR_UNVERIFIED';evidence.error=e.message;save();console.error(e.message);process.exitCode=1;}
finally{if(E.GITHUB_STEP_SUMMARY)appendFileSync(E.GITHUB_STEP_SUMMARY,'### Same-version verification\n'+JSON.stringify(evidence,null,2)+'\n');}
