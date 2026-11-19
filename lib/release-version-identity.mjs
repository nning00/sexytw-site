// Pure, bounded read-after-upload verification. Never uploads or activates.
export async function waitForUploadedVersion({list,view,tag,sha,startedAt,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),onPoll=()=>{},attempts=10}) {
 if(!/^[0-9a-f]{40}$/.test(sha)||typeof tag!=='string'||!tag.startsWith(sha+'-')||!/^\d+$/.test(tag.slice(41))||!Number.isFinite(startedAt)||!Number.isInteger(attempts)||attempts<2||attempts>10)throw Error('UPLOAD_IDENTITY_INPUT_INVALID');
 const deadline=now()+60000;
 let candidate=null,stable=0;
 for(let attempt=1;attempt<=attempts;attempt++){
  if(now()>=deadline)throw Error('UPLOAD_VERSION_NOT_VISIBLE_WITHIN_BUDGET');
  const versions=await list(Math.min(20000,deadline-now()));
  if(!Array.isArray(versions))throw Error('UPLOAD_LIST_INVALID');
  const matches=versions.filter(v=>v?.annotations?.['workers/tag']===tag);
  onPoll({attempt,matches:matches.length});
  if(matches.length>1)throw Error('UPLOAD_ID_NOT_UNIQUE');
  if(!matches.length){stable=0;}
  else {
   const value=matches[0],id=value.id;
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id||''))throw Error('UPLOAD_VERSION_ID_INVALID');
   if(candidate!==null&&candidate!==id)throw Error('UPLOAD_IDENTITY_CHANGED');
   candidate=id;
   if(now()>=deadline)throw Error('UPLOAD_VERSION_NOT_VISIBLE_WITHIN_BUDGET');
   const detail=await view(id,Math.min(20000,deadline-now()));
   if(now()>=deadline)throw Error('UPLOAD_VERSION_NOT_VISIBLE_WITHIN_BUDGET');
   for(const v of [value,detail]){
    const created=Date.parse(v?.metadata?.created_on||'');
    if(v?.id!==id||v?.annotations?.['workers/tag']!==tag||v?.annotations?.['workers/message']!=='controlled create-only '+sha||!Number.isFinite(created)||created<startedAt-30000||created>now()+30000)throw Error('UPLOAD_VERSION_DETAILS_MISMATCH');
   }
   if(++stable===2)return id;
  }
  if(attempt<attempts){if(now()+3000>=deadline)throw Error('UPLOAD_VERSION_NOT_VISIBLE_WITHIN_BUDGET');await pause(3000);}
 }
 throw Error('UPLOAD_VERSION_NOT_VISIBLE_WITHIN_BUDGET');
}
