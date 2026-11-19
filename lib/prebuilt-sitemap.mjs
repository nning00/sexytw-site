import { sitemapUnavailableResponse } from './live-sitemap.mjs';
const site='https://sexytw.cc',supabase='https://lsxrpubpbnshlqnnddgu.supabase.co';
const revisionPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[0-9]{1,19}$/;
const clientHeaders={'Content-Type':'application/xml; charset=utf-8','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'private, no-store, max-age=0','Cloudflare-CDN-Cache-Control':'private, no-store, max-age=0'};
function validate(data){
 if(data?.site!=='sexytw'||data.version!==1||!revisionPattern.test(data.revision)||!Number.isInteger(data.urls)||data.urls<4||data.urls>50000||!Number.isInteger(data.bytes)||data.bytes<=0||data.bytes>52428800)throw Error('SITEMAP_UNAVAILABLE');
 return data;
}
/** Persisted DB file is authoritative; Cache API is optional, local-colo acceleration.
 * @param {Request} request
 * @param {{SITE_URL?: string, NEXT_PUBLIC_SITE_URL?: string, NEXT_PUBLIC_SUPABASE_URL?: string, NEXT_PUBLIC_SUPABASE_SCHEMA?: string, NEXT_PUBLIC_MEDIA_PREFIX?: string, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string}} env
 * @param {{fetchImpl?: typeof fetch, cache?: {match(request: Request): Promise<Response | undefined>, put(request: Request, response: Response): Promise<unknown>}, waitUntil?: (pending: Promise<unknown>) => void}} options
 */
export async function prebuiltSitemapResponse(request,env,{fetchImpl=fetch,cache,waitUntil}={}){
 const method=request.method;
 if(!['GET','HEAD'].includes(method))return new Response(null,{status:405,headers:{...clientHeaders,Allow:'GET, HEAD'}});
 try{
  if((env.SITE_URL||env.NEXT_PUBLIC_SITE_URL)!==site||env.NEXT_PUBLIC_SUPABASE_URL!==supabase||env.NEXT_PUBLIC_SUPABASE_SCHEMA!=='public'||env.NEXT_PUBLIC_MEDIA_PREFIX!=='sexytw')throw Error('SITEMAP_TARGET');
  const key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(typeof key!=='string'||!key.startsWith('sb_publishable_'))throw Error('SITEMAP_PUBLIC_KEY');
  const started=performance.now();
  async function read(metadataOnly,revision){
   const remaining=Math.floor(8000-(performance.now()-started));if(remaining<=0)throw Error('SITEMAP_UNAVAILABLE');
   const url=new URL(supabase+'/rest/v1/rpc/sexytw_sitemap_file_v1');url.searchParams.set('metadata_only',String(metadataOnly));if(revision)url.searchParams.set('expected_revision',revision);
   const response=await fetchImpl(url,{method:'GET',headers:{apikey:key,'Accept-Profile':'public',Accept:'application/json'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(remaining)});
   if(!response.ok)throw Error('SITEMAP_UNAVAILABLE');
   return await response.json();
  }
  // Bounded retry only if a source mutation commits between the gate and file read.
  for(let attempt=0;attempt<2;attempt++){
   const meta=validate(await read(true));
   const headers={...clientHeaders,ETag:'"sexytw-sitemap-v1-'+meta.revision+'"','X-Sexytw-Sitemap-Revision':meta.revision,'X-Sexytw-Sitemap-URLs':String(meta.urls),'Server-Timing':`sitemap_gate;dur=${(performance.now()-started).toFixed(1)}`};
   // A 304 is safe only after the same fresh gate as a 200, never on upstream error.
   if(request.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
   if(method==='HEAD')return new Response(null,{headers});
   const cacheKey=new Request(site+'/__sitemap-file-cache/v1/'+meta.revision+'.xml');
   let cached;try{cached=await cache?.match(cacheKey);}catch{/* Availability does not depend on cache. */}
   if(cached?.ok&&cached.headers.get('X-Sexytw-Sitemap-Revision')===meta.revision&&cached.headers.get('Content-Type')===clientHeaders['Content-Type']){
    return new Response(cached.body,{headers:{...headers,'X-Sexytw-Sitemap-Cache':'HIT'}});
   }
   const file=await read(false,meta.revision);
   if(file===null)continue;
   validate(file);
   if(file.revision!==meta.revision||file.bytes!==meta.bytes||file.urls!==meta.urls||typeof file.xml!=='string'||new TextEncoder().encode(file.xml).length!==file.bytes||!file.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')||!file.xml.endsWith('</urlset>'))throw Error('SITEMAP_UNAVAILABLE');
   if(cache){
    const stored=new Response(file.xml,{headers:{'Content-Type':clientHeaders['Content-Type'],'Cache-Control':'public, max-age=86400','X-Sexytw-Sitemap-Revision':meta.revision}});
    const put=Promise.resolve().then(()=>cache.put(cacheKey,stored)).catch(()=>{});
    if(waitUntil)waitUntil(put);else await put;
   }
   return new Response(file.xml,{headers:{...headers,'X-Sexytw-Sitemap-Cache':'MISS'}});
  }
 }catch{/* Do not disclose upstream errors, credentials or private data. */}
 return sitemapUnavailableResponse(method);
}
