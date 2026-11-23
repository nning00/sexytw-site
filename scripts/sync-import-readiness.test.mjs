import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partitionImportReadiness } from '../lib/sync-import-readiness.mjs';
import { collectCatalog } from '../lib/edc-catalog.mjs';

test('empty source media is deferred, never fabricated, and original records are unchanged', () => {
  const input = [{sourceKey:'1',images:[]},{sourceKey:'2',images:[{url:'https://edc.com.tw/test.jpg'}]},{sourceKey:'3'}];
  const before = JSON.stringify(input);
  const {ready,pendingImages} = partitionImportReadiness(input);
  assert.deepEqual(pendingImages.map(p=>p.sourceKey),['1']);
  assert.deepEqual(ready.map(p=>p.sourceKey),['2','3']);
  assert.equal(JSON.stringify(input),before);
});
test('deferred media identities remain in full source proof, preventing false removal', async () => {
  const catalog = await collectCatalog({fetchPage:async()=>({data:[{id:1},{id:2}],headers:new Headers({'x-wp-total':'2','x-wp-totalpages':'1'})}),normalizeProduct:p=>({sourceKey:String(p.id),images:p.id===1?[]:[{}]})});
  assert.equal(partitionImportReadiness(catalog.profiles).ready.length,1);
  assert.deepEqual(catalog.sourceKeys,['1','2']);
  assert.equal(catalog.snapshotProof.rawCount,2);
  const cli=readFileSync(new URL('./edc-profile-sync.mjs',import.meta.url),'utf8');
  assert.match(cli,/snapshotSourceKeys:catalogue.sourceKeys/);
  assert.match(cli,/chunks.push\(importProfiles.slice\(index, index \+ batchSize\)\)/);
});
