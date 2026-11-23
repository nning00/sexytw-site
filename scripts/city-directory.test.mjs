import test from 'node:test';
import assert from 'node:assert/strict';
import {cityPageDirectory} from '../lib/city-pagination.mjs';
test('every current city page is directly linked with bounded output',()=>{
  assert.deepEqual(cityPageDirectory(7),[1,2,3,4,5,6,7]);
  assert.equal(cityPageDirectory(261).length,261);
  assert.equal(cityPageDirectory(500).at(-1),500);
  for(const invalid of [0,-1,1.5,NaN,Infinity,501])assert.deepEqual(cityPageDirectory(invalid),[]);
});
