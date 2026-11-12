// Real adapter for GitHub Actions only. Never run this for local validation.
import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {controlledRelease,releaseIdentity,previousReleaseGate,soleVersion} from '../lib/release-gate.mjs';
const e=process.env;const repo='nning00/sexytw-site',config='wrangler.jsonc';
releaseIdentity({event:e.GITHUB_EVENT_NAME,ref:e.GITHUB_REF,sha:e.GITHUB_SHA,expectedSha:e.EXPECTED_SHA,runAttempt:e.GITHUB_RUN_ATTEMPT});
if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_REPOSITORY!==repo||e.CLOUDFLARE_ACCOUNT_ID!=='f9f173ed7748397ad18c0df63220fc3f')throw Error('WRONG_RELEASE_TARGET');
for(const k of ['GH_TOKEN','CLOUDFLARE_API_TOKEN','PROFILE_SYNC_SECRET','EXPECTED_PREVIOUS_VERSION'])if(!e[k])throw Error('MISSING_'+k);
const evidence=[];mkdirSync('release-evidence',{recursive:true});
const wr=(...args)=>execFileSync('pnpm',['exec','wrangler',...args,'--config',config],{encoding:'utf8',timeout:180000,stdio:['ignore','pipe','pipe']}).trim();
async function gh(path){const r=await fetch('https://api.github.com/repos/'+repo+'/'+path,{headers:{Authorization:'Bearer '+e.GH_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('GITHUB_READ_FAILED_'+r.status);return await r.json();}
const active=async()=>{const d=JSON.parse(wr('deployments','list','--json'));if(!Array.isArray(d)||!d.length)throw Error('CF_DEPLOYMENTS_UNAVAILABLE');d.sort((a,b)=>a.created_on.localeCompare(b.created_on));return soleVersion(d.at(-1));};
async function oldHealth(){for(const path of ['/','/api/health']){const r=await fetch('https://sexytw.cc'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HEALTH_HTTP_'+r.status);if(path==='/api/health'){const j=await r.json();if(j.ok!==true||j.database!=='connected')throw Error('HEALTH_DATABASE');}}}
const tag=e.GITHUB_SHA+'-'+e.GITHUB_RUN_ID;
await controlledRelease({
 async validate(){
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(head!==e.GITHUB_SHA)throw Error('CHECKOUT_SHA_MISMATCH');
  const own=JSON.parse(readFileSync('package.json','utf8'));if(own.devDependencies.wrangler!=='4.92.0')throw Error('WRANGLER_VERSION_DRIFT');
  const history=await gh('actions/workflows/controlled-release.yml/runs?per_page=100');previousReleaseGate(history.workflow_runs,e.GITHUB_RUN_ID);
 },
 active,
 async assertPrevious(v){if(v!==e.EXPECTED_PREVIOUS_VERSION)throw Error('UNEXPECTED_BASELINE');const versions=JSON.parse(wr('versions','list','--json'));if(!versions.some(x=>x.id===v))throw Error('ROLLBACK_VERSION_UNAVAILABLE');wr('versions','deploy',v+'@100','--dry-run','--yes');},
 async assertSyncDisabled(){const w=await gh('actions/workflows/profile-sync.yml');if(w.state!=='disabled_manually')throw Error('SYNC_NOT_DISABLED');const runs=await gh('actions/workflows/profile-sync.yml/runs?per_page=100');if(runs.workflow_runs.some(x=>['queued','in_progress','waiting','pending','requested'].includes(x.status)))throw Error('SYNC_RUN_ACTIVE');},
 oldHealth,
 async persist(v){evidence.push({...v,at:new Date().toISOString(),sha:e.GITHUB_SHA});writeFileSync('release-evidence/state.json',JSON.stringify(evidence,null,2));},
 async upload(){wr('versions','upload','--tag',tag,'--message','controlled create-only '+e.GITHUB_SHA,'--keep-vars');const v=JSON.parse(wr('versions','list','--json')).filter(x=>x.annotations?.['workers/tag']===tag);if(v.length!==1)throw Error('UPLOAD_ID_NOT_UNIQUE');return v[0].id;},
 async assertMainUnchanged(){const main=await gh('git/ref/heads/main');if(main.object.sha!==e.GITHUB_SHA)throw Error('MAIN_MOVED');},
 async activate(id){wr('versions','deploy',id+'@100','--yes','--message','controlled '+e.GITHUB_SHA);},
 async newHealth(){await oldHealth();const r=await fetch('https://sexytw.cc/api/profile-sync',{headers:{Authorization:'Bearer '+e.PROFILE_SYNC_SECRET,'X-Sync-Recovery':'create-only-v1'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('NEW_PREFLIGHT_HTTP_'+r.status);const j=await r.json();if(j.ok!==true||j.createOnlyVersion!==1||j.databaseReachable!==true||j.target?.siteUrl!=='https://sexytw.cc'||j.target?.supabaseUrl!=='https://lsxrpubpbnshlqnnddgu.supabase.co')throw Error('NEW_PREFLIGHT_CAPABILITY');},
 async rollback(id){wr('rollback',id,'--yes','--message','rollback failed controlled release '+e.GITHUB_SHA);}
});
