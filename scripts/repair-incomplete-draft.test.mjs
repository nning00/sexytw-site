import test from 'node:test';
import assert from 'node:assert/strict';
import {repairIncompleteDraft} from '../lib/repair-incomplete-draft.mjs';
const current={id:'10000000-0000-0000-0000-000000000001',status:'draft',source_content_hash:'create-only:30000000-0000-0000-0000-000000000001',created_at:'2026-11-12T00:00:00Z',updated_at:'2026-11-12T00:00:00Z',source_url:'https://edc.com.tw/fixture/'};
const profile={sourceUrl:current.source_url,images:[{url:'https://edc.com.tw/a.webp',alt:'fixture'}]};
function fixture({child=false,rpcError=false}={}){
 const calls=[];
 return {calls,client:{from(table){calls.push(['select',table]);return {select(){return {eq:async()=>({data:table==='profile_cities'?[{city_id:'city'}]:child?[{}]:[]})};}};},storage:{from(bucket){return {upload:async(path,bytes,opts)=>{calls.push(['upload',bucket,path,opts]);return {error:null};}};}},rpc:async(name,params)=>{calls.push(['rpc',name,params]);return rpcError?{error:{message:'fixture'}}:{data:{ok:true,status:'draft'}};}}};
}
test('repair rejects published, manually edited and mismatched source rows before writes',async()=>{
 for(const patch of [{status:'published'},{updated_at:'changed'},{card_image_path:'sexytw/manual.jpg'},{source_url:'https://other.invalid/'},{source_content_hash:'finished'}]){const x=fixture();await assert.rejects(repairIncompleteDraft(x.client,{...current,...patch},profile),/requires-review/);assert.equal(x.calls.length,0);}
});
test('repair rejects existing child edits before any download',async()=>{const x=fixture({child:true});await assert.rejects(repairIncompleteDraft(x.client,current,profile,{download:()=>assert.fail()}),/requires-review/);assert(!x.calls.some(c=>c[0]==='upload'));});
test('source failure never uploads or modifies a parent/child record',async()=>{const x=fixture();await assert.rejects(repairIncompleteDraft(x.client,current,profile,{download:async()=>{throw Error('image-download-525');}}),/525/);assert(x.calls.every(c=>c[0]==='select'));});
test('success only uploads fresh owned objects and calls guarded transaction',async()=>{const x=fixture();await repairIncompleteDraft(x.client,current,profile,{download:async()=>({bytes:new Uint8Array([1]),contentType:'image/webp',extension:'webp'})});const upload=x.calls.find(c=>c[0]==='upload');assert.equal(upload[1],'site-media');assert(upload[2].startsWith(`sexytw/profiles/synced/${current.id}/repair-`));assert.equal(upload[3].upsert,false);const rpc=x.calls.find(c=>c[0]==='rpc');assert.equal(rpc[1],'sexytw_repair_incomplete_draft');assert.equal(rpc[2].p_expected_updated_at,current.updated_at);assert(!('status' in rpc[2]));});
test('post-upload CAS refusal remains an error, never claims repaired',async()=>{const x=fixture({rpcError:true});await assert.rejects(repairIncompleteDraft(x.client,current,profile,{download:async()=>({bytes:new Uint8Array([1]),contentType:'image/webp',extension:'webp'})}),/requires-review/);});
