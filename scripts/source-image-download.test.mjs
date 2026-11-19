import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {downloadSourceImage,prefetchSourceImages} from '../lib/source-image-download.mjs';
const url='https://edc.com.tw/test.webp';
test('temporary 5xx retries bounded reads, with redirect and timeout protection',async()=>{
 let calls=0;const waits=[];
 const file=await downloadSourceImage(url,{pause:async ms=>waits.push(ms),fetcher:async(u,opts)=>{
  assert.equal(u,url);assert.equal(opts.redirect,'manual');assert(opts.signal);calls++;
  return calls<3?new Response(null,{status:525}):new Response('fixture',{headers:{'content-type':'image/webp'}});
 }});
 assert.equal(calls,3);assert.deepEqual(waits,[3000,6000]);assert.equal(file.extension,'webp');
});

test('every redirect is rejected without retry or following Location',async()=>{
 for(const status of [300,301,302,303,304,307,308,399]){
  let calls=0,cancelled=false;
  const body=status===304?null:new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(downloadSourceImage(url,{pause:async()=>assert.fail(),fetcher:async(u,opts)=>{
   calls++;assert.equal(u,url);assert.equal(opts.redirect,'manual');
   return new Response(body,{status,headers:{location:'https://untrusted.invalid/private'}});
  }}),/image-redirect-rejected/);
  assert.equal(calls,1);if(body)assert.equal(cancelled,true);
 }
});
test('denied, missing and rate-limited images are never retried or bypassed',async()=>{
 for(const status of [401,403,404,429]){let calls=0;await assert.rejects(downloadSourceImage(url,{pause:async()=>assert.fail(),fetcher:async()=>{calls++;return new Response(null,{status});}}),new RegExp(`image-download-${status}`));assert.equal(calls,1);}
});
test('untrusted hosts, userinfo and active content are rejected',async()=>{
 for(const bad of ['https://other.invalid/a.jpg','http://edc.com.tw/a.jpg','https://u:p@edc.com.tw/a.jpg']) await assert.rejects(downloadSourceImage(bad),/image-url/);
 await assert.rejects(downloadSourceImage(url,{fetcher:async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})}),/image-content-type/);
});
test('size limit stops streams and empty images fail',async()=>{
 for(const bytes of [new Uint8Array(),new Uint8Array(15*1024*1024+1)])await assert.rejects(downloadSourceImage(url,{fetcher:async()=>new Response(bytes,{headers:{'content-type':'image/webp'}})}),/image-size/);
});
test('all source reads finish before any caller may insert a new draft',async()=>{
 let reads=0;await assert.rejects(prefetchSourceImages([{url:'one'},{url:'two'}],async()=>{if(++reads===2)throw Error('image-download-525');return {};}),/525/);
 const route=readFileSync(new URL('../app/api/profile-sync/route.ts',import.meta.url),'utf8');
 assert(route.indexOf('const prefetched = body.createOnly')<route.indexOf('const save = current'));
 assert.match(route,/syncImages\(profileId, profile.displayName, profile.images, body.createOnly, prefetched\)/);
});
test('repair transaction never changes publication status or deletes data',()=>{
 const sql=readFileSync(new URL('../draft-repair.review.sql',import.meta.url),'utf8');
 assert(!/\b(?:DELETE|TRUNCATE)\b/i.test(sql));assert(!/\bSET\s+status\s*=/i.test(sql));assert(!/SECURITY\s+DEFINER/i.test(sql));
 for(const value of ['r.updated_at IS DISTINCT FROM r.created_at','FOR UPDATE','r.status IS DISTINCT FROM \'draft\'','storage.objects','FROM PUBLIC,anon,authenticated'])assert(sql.includes(value));
});
