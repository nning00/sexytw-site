import test from 'node:test';
import assert from 'node:assert/strict';
import {CITY_PAGE_SIZE,parseCityPage,cityPagePath,cityPageNumbers,queryCityProfilePage,cityCardFields} from '../lib/city-pagination.mjs';
import {withPublicReadScope,publicReadOnce} from '../lib/public-read-scope.mjs';

test('strict bounded page parsing and clean self-canonical paths',()=>{
  assert.equal(CITY_PAGE_SIZE,20);
  assert.equal(parseCityPage(undefined),1);
  for(const page of ['1','2','100000']) assert.equal(parseCityPage(page),Number(page));
  for(const value of ['', '0','-1','1.5','01','1e2','100001','9999999999',['1','2']]) assert.equal(parseCityPage(value),null);
  assert.equal(cityPagePath('north','taipei',1),'/regions/north/taipei');
  assert.equal(cityPagePath('north','taipei',2),'/regions/north/taipei?page=2');
});
test('page windows bounded and can reach first, next and last',()=>{
  for(let page=1;page<=500;page++){
    const nums=cityPageNumbers(page,500);
    assert(nums.length<=5);assert(nums.includes(1));assert(nums.includes(500));assert(nums.includes(page));
    if(page<500)assert(nums.includes(page+1));
  }
  assert.deepEqual(cityPageNumbers(1,1),[1]);
});
function fakeClient(result){
  const ops=[];const q={then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};
  for(const method of ['select','eq','is','order','range']) q[method]=(...args)=>{ops.push([method,...args]);return q};
  return {ops,from(table){ops.push(['from',table]);return q}};
}
test('one thin query, live visibility, exact count and stable parent ordering before range',async()=>{
  const db=fakeClient({data:[{profiles:{id:'fixture'}}],count:41,error:null});
  assert.deepEqual(await queryCityProfilePage(db,'fixture-city',2),{profiles:[{id:'fixture'}],total:41});
  assert.deepEqual(db.ops.filter(x=>x[0]==='from'),[['from','profile_cities']]);
  assert.deepEqual(db.ops.at(-1),['range',20,39]);
  assert.deepEqual(db.ops.filter(x=>x[0]==='order').map(x=>x[1]),['profiles(sort_order)','profiles(created_at)','profile_id']);
  assert(db.ops.some(x=>x[0]==='eq'&&x[1]==='profiles.status'&&x[2]==='published'));
  assert(db.ops.some(x=>x[0]==='is'&&x[1]==='profiles.source_missing_at'&&x[2]===null));
  assert.doesNotMatch(cityCardFields,/introduction|seo_|profile_images/);
});
test('empty data is not replaced by examples, out-of-range is empty, failures are not empty success',async()=>{
  assert.deepEqual(await queryCityProfilePage(fakeClient({data:[],count:0}),'city',1),{profiles:[],total:0});
  assert.deepEqual(await queryCityProfilePage(fakeClient({error:{code:'PGRST103'}}),'city',99),{profiles:[],total:0});
  await assert.rejects(queryCityProfilePage(fakeClient({error:{message:'secret'}}),'city',1),/^Error: City profile query failed$/);
  await assert.rejects(queryCityProfilePage(fakeClient({}),'city',Infinity),/Invalid city page/);
});
test('city stages share within request, not across requests, and timing never exposes IDs',async()=>{
  let count=0;
  const render=()=>withPublicReadScope(async()=>{
    await Promise.all([publicReadOnce('profiles:city-page:private-id',()=>++count),publicReadOnce('profiles:city-page:private-id',()=>++count)]);
    return new Response('ok');
  });
  const first=await render();assert.equal(count,1);assert.match(first.serverTiming,/cms_city_profiles;dur=/);assert.doesNotMatch(first.serverTiming,/private-id/);
  await render();assert.equal(count,2);
});
