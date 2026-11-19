import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {Miniflare,Log,LogLevel}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const moduleSource=readFileSync(new URL('../lib/prebuilt-sitemap.mjs',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../lib/live-sitemap.mjs',import.meta.url),'utf8');
const rev='12345678-1234-1234-1234-123456789012-1',next=rev.slice(0,-1)+'2';
const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://sexytw.cc/</loc></url></urlset>';
test('real Workers Cache API: MISS, HIT, live withdrawal gate and unavailable DB', {timeout:30000},async()=>{
 let revision=rev,available=true;const calls=[];
 const mf=new Miniflare({modules:[{type:'ESModule',path:'worker.mjs',contents:`import {prebuiltSitemapResponse} from './prebuilt-sitemap.mjs';export default {async fetch(request,env,ctx){return prebuiltSitemapResponse(request,env,{cache:await caches.open('sexytw-sitemap-files-v1'),waitUntil:p=>ctx.waitUntil(p)})}}`},{type:'ESModule',path:'prebuilt-sitemap.mjs',contents:moduleSource},{type:'ESModule',path:'live-sitemap.mjs',contents:fallback}],compatibilityDate:'2026-05-15',log:new Log(LogLevel.ERROR),bindings:{SITE_URL:'https://sexytw.cc',NEXT_PUBLIC_SUPABASE_URL:'https://lsxrpubpbnshlqnnddgu.supabase.co',NEXT_PUBLIC_SUPABASE_SCHEMA:'public',NEXT_PUBLIC_MEDIA_PREFIX:'sexytw',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},outboundService:async request=>{
  const u=new URL(request.url);assert.equal(u.host,'lsxrpubpbnshlqnnddgu.supabase.co');calls.push(u.searchParams.get('metadata_only'));
  if(!available)return new Response(null,{status:503});
  const known=u.searchParams.get('known_revision');
  return Response.json({site:'sexytw',version:1,revision,urls:4,bytes:Buffer.byteLength(xml),xml:u.searchParams.get('metadata_only')==='true'||known===revision?null:xml});
 }});
 try{
  const first=await mf.dispatchFetch('https://sexytw.cc/sitemap.xml');assert.equal(first.status,200,'RPC calls: '+JSON.stringify(calls));assert.equal(first.headers.get('X-Sexytw-Sitemap-Cache'),'MISS');assert.equal(await first.text(),xml);
  const second=await mf.dispatchFetch('https://sexytw.cc/sitemap.xml');assert.equal(second.status,200);assert.equal(second.headers.get('X-Sexytw-Sitemap-Cache'),'HIT');assert.equal(await second.text(),xml);assert.deepEqual(calls,['false','false']);
  revision=next;const changed=await mf.dispatchFetch('https://sexytw.cc/sitemap.xml');assert.equal(changed.headers.get('X-Sexytw-Sitemap-Cache'),'MISS');assert.equal(changed.headers.get('X-Sexytw-Sitemap-Revision'),next);await changed.text();
  available=false;const failed=await mf.dispatchFetch('https://sexytw.cc/sitemap.xml');assert.equal(failed.status,503);assert(!((await failed.text()).includes('<urlset')));
 }finally{await mf.dispose();}
});
