const unavailable=()=>Error('SITEMAP_DATA_UNAVAILABLE');
const groups=['profiles','articles','cities','categories','services'];
function segment(value){
 if(typeof value!=='string'||!value||value.length>400||/[\/\\?#\u0000-\u0020]/.test(value)||value==='.'||value==='..')throw unavailable();
 return encodeURIComponent(value);
}
function date(value){
 if(value===null||value===undefined)return undefined;
 if(typeof value!=='string')throw unavailable();
 const parsed=new Date(value);return Number.isNaN(parsed.getTime())?undefined:parsed;
}
export function sitemapEntries(data,siteUrl){
 if(siteUrl!=='https://sexytw.cc'||data?.site!=='sexytw'||data.version!==1)throw unavailable();
 for(const key of groups)if(!Array.isArray(data[key]))throw unavailable();
 const entries=[
  {url:siteUrl,changeFrequency:'weekly',priority:1},
  {url:siteUrl+'/articles',changeFrequency:'weekly',priority:0.8},
  {url:siteUrl+'/privacy',changeFrequency:'yearly',priority:0.2},
  {url:siteUrl+'/terms',changeFrequency:'yearly',priority:0.2},
 ];
 if(groups.reduce((n,k)=>n+data[k].length,entries.length)>50000)throw unavailable();
 for(const s of data.services)entries.push({url:siteUrl+'/services/'+segment(s?.slug),changeFrequency:'monthly',priority:0.7});
 for(const c of data.cities)entries.push({url:siteUrl+'/regions/'+segment(c?.region)+'/'+segment(c?.slug),changeFrequency:'weekly',priority:0.7});
 for(const c of data.categories)entries.push({url:siteUrl+'/articles/category/'+segment(c?.slug),changeFrequency:'weekly',priority:0.7});
 for(const a of data.articles)entries.push({url:siteUrl+'/articles/'+segment(a?.slug),lastModified:date(a?.updated_at),changeFrequency:'monthly',priority:0.65});
 for(const p of data.profiles)entries.push({url:siteUrl+'/profiles/'+segment(p?.slug),lastModified:date(p?.updated_at),changeFrequency:'weekly',priority:0.6});
 if(new Set(entries.map(x=>x.url)).size!==entries.length)throw unavailable();
 return entries;
}
/** No memoization/fallback: every request observes a fresh committed snapshot. */
export async function readLiveSitemap(client,siteUrl){
 try{
  const {data,error}=await client.rpc('sexytw_public_sitemap_v1',{}, {get:true}).abortSignal(AbortSignal.timeout(8000));
  if(error)throw unavailable();
  return sitemapEntries(data,siteUrl);
 }catch{throw unavailable();}
}
export function sitemapUnavailableResponse(method='GET'){
 return new Response(method==='HEAD'?null:'Sitemap temporarily unavailable',{status:503,headers:{
  'Content-Type':'text/plain; charset=utf-8','Retry-After':'60',
  'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'private, no-store, max-age=0','Cloudflare-CDN-Cache-Control':'private, no-store, max-age=0',
 }});
}
