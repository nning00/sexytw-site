import test from 'node:test';
import assert from 'node:assert/strict';
import {queryArticleCardIndex,articleCardIndexFields} from '../lib/article-card-index.mjs';
function client(result){const calls=[];const q={then:(yes,no)=>Promise.resolve(result).then(yes,no)};for(const method of ['select','eq','order','limit'])q[method]=(...a)=>{calls.push([method,...a]);return q;};return {calls,from:t=>{calls.push(['from',t]);return q;}};}
test('cards omit bodies, keep category identity and ALT, with published filter and stable order',async()=>{
  const db=client({data:[{slug:'fixture'}]});assert.equal((await queryArticleCardIndex(db,8))[0].slug,'fixture');
  assert.doesNotMatch(articleCardIndexFields,/content|seo_/);assert.match(articleCardIndexFields,/category_id/);assert.match(articleCardIndexFields,/cover_image_alt/);
  assert(db.calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='published'));
  assert.deepEqual(db.calls.at(-1),['limit',8]);
});
test('failures stay failures, empty remains empty, invalid limits rejected',async()=>{
  await assert.rejects(queryArticleCardIndex(client({error:{message:'private'}})),/^Error: Article card index query failed$/);
  assert.deepEqual(await queryArticleCardIndex(client({data:[]})),[]);
  await assert.rejects(queryArticleCardIndex(client({}),0),/Invalid article card limit/);
});
