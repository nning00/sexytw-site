import test from "node:test";
import assert from "node:assert/strict";
import { resumeMediaUrl, resumeMediaPlaceholder } from "../lib/resume-media-url.mjs";
const key="sexytw/resume-v2/12345678-0000-4000-8000-000000000001/0-"+"a".repeat(64)+".png";
test("private resume keys never fall back to public shared bucket",()=>{
 for (const off of [undefined,"","false","0",true,1]) assert.equal(resumeMediaUrl(key,off),resumeMediaPlaceholder);
});
test("only exact enabled and canonical object maps to same-origin guarded reader",()=>{
 assert.equal(resumeMediaUrl(key,"1"),"/media/profile/v2/"+key.split("/").slice(2).join("/"));
 for (const malformed of ["sexytw/resume-v2/../a.jpg",key+"?q=1",key.replace("/0-","/%30-"),key.replace("/0-","/3-"),key.replace(".png",".html")]) {
  assert.equal(resumeMediaUrl(malformed,"1"),resumeMediaPlaceholder);
 }
});
test("ordinary legacy/external/public/placeholder paths are not handled",()=>{
 for (const legacy of ["sexytw/profiles/synced/other.jpg","sexytw/articles/cover.webp","https://fixture.invalid/image","/placeholders/hero.svg",null,undefined]) {
  assert.equal(resumeMediaUrl(legacy,"1"),undefined);
 }
});

test("cacheable optimizer front doors refuse protected images, old images unaffected",async()=>{
 const { isProtectedImageOptimizerRequest, isResumeMediaPublicRoute }=await import("../lib/resume-media-url.mjs");
 const protectedPath=resumeMediaUrl(key,"1");
 assert.equal(isResumeMediaPublicRoute(protectedPath),true);
 const parent="https://fixture.invalid";
 for(const route of ["/_next/image","/_vinext/image","/_next/image/","/_vinext/image/"]) {
  for(const src of [protectedPath,encodeURIComponent(protectedPath),"/assets/../"+protectedPath.slice(1),protectedPath.replaceAll("/","\\")]){
   const p=new URL(route,parent);p.searchParams.set("url",src);p.searchParams.set("w","640");p.searchParams.set("q","64");
   assert.equal(isProtectedImageOptimizerRequest(p),true,src);
  }
  for(const src of ["/placeholders/hero.svg","/assets/logo.png","https://fixture.invalid/storage/v1/object/public/site-media/sexytw/legacy.jpg"]){
   const p=new URL(route,parent);p.searchParams.set("url",src);
   assert.equal(isProtectedImageOptimizerRequest(p),false);
  }
 }
 assert.equal(isProtectedImageOptimizerRequest(new URL(protectedPath,parent)),false);
});
