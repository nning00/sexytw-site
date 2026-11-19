import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Reuse Wrangler's locked runtime; no new dependency, credentials or network.
const {Miniflare,Log,LogLevel}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const helper=readFileSync(new URL('../lib/source-image-download.mjs',import.meta.url),'utf8');

test('real Workers runtime downloads images but never follows redirects', {timeout:30000}, async()=>{
 const requests=[];
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),
  outboundService:async request=>{
   requests.push(request.url);
   if(new URL(request.url).pathname==='/redirect.webp')return new Response(null,{status:302,headers:{location:'https://untrusted.invalid/not-allowed'}});
   return new Response('synthetic-image',{headers:{'content-type':'image/webp'}});
  },
  script:helper+`\nexport default {async fetch(request){
   try{const file=await downloadSourceImage('https://edc.com.tw'+new URL(request.url).pathname);return Response.json({bytes:file.bytes.length,type:file.contentType});}
   catch(error){return Response.json({error:error.message});}
  }}`,
 });
 try{
  assert.deepEqual(await(await mf.dispatchFetch('http://localhost/success.webp')).json(),{bytes:15,type:'image/webp'});
  assert.deepEqual(await(await mf.dispatchFetch('http://localhost/redirect.webp')).json(),{error:'image-redirect-rejected'});
  assert.deepEqual(requests,['https://edc.com.tw/success.webp','https://edc.com.tw/redirect.webp']);
 }finally{await mf.dispose();}
});
