import test from 'node:test';
import assert from 'node:assert/strict';
import {assertZeroActiveJobs} from './release-d1-guard.mjs';
const reply=(n,success=true)=>JSON.stringify([{results:[{active_jobs:n}],success,meta:{duration:0.35}}]);
test('one successful row with zero active Discord jobs passes',()=>{
 assert.deepEqual(assertZeroActiveJobs(reply(0)),{status:'pass',active_jobs:0});
});
test('one or more queued, claimed or active-slot jobs block release',()=>{
 for(const n of [1,2,77])assert.throws(()=>assertZeroActiveJobs(reply(n)),/BLOCKED_ACTIVE_JOBS/);
});
test('fail closed on malformed, unsuccessful and incomplete data',()=>{
 for(const x of ['','not json','{}','[]','null','[{}]',JSON.stringify([{results:[],success:true}]),
   JSON.stringify([{results:[{active_jobs:0}],success:false}]),
   JSON.stringify([{results:[{active_jobs:0}]}]),
   JSON.stringify([{results:[{active_jobs:0},{active_jobs:0}],success:true}]),
   JSON.stringify([{results:[{active_jobs:0}],success:true},{results:[{active_jobs:0}],success:true}])]){
   assert.throws(()=>assertZeroActiveJobs(x));
 }
});
test('reject ambiguous counts, negative values and untrusted extra fields',()=>{
 for(const n of ['0',null,-1,0.5,Number.MAX_SAFE_INTEGER+1]){
   assert.throws(()=>assertZeroActiveJobs(reply(n)));
 }
 assert.throws(()=>assertZeroActiveJobs(JSON.stringify([{success:true,results:[{active_jobs:0,user_id:'sensitive'}]}])));
});
