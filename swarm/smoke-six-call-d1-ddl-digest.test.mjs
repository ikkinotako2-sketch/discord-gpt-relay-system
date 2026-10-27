import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {attestSixCallD1SqlDefinitions,
 D1_SMOKE_EXPECTED_DDL_SHA256} from './smoke-six-call-d1-ddl-digest.mjs';
import {collectSixCallD1ReadOnly,D1_SCHEMA_SELECT,D1_STATE_SELECT}
 from './smoke-six-call-d1-readonly-audit.mjs';
const now=Date.UTC(2026,9,27,11,45);
function schema(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./smoke-six-call-d1-schema.review.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./smoke-six-call-owner-prepare-index.review.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./smoke-six-call-output-artifacts.review.sql',import.meta.url),'utf8'));
 const rows=db.prepare(D1_SCHEMA_SELECT).all();return {db,rows};
}
function mock(db,{changeRows=x=>x}={}){
 const queries=[];
 return {queries,fetchImpl:async (url,options)=>{
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert.ok([D1_SCHEMA_SELECT,D1_STATE_SELECT].includes(body.sql));
  assert.equal(body.sql.slice(0,6),'SELECT');
  assert.ok([9,10,13,32].includes(body.sql.charCodeAt(6)));
  queries.push(body.sql);
  const rows=body.sql===D1_SCHEMA_SELECT?changeRows(db.prepare(body.sql).all()):
    db.prepare(body.sql).all();
  return {status:200,ok:true,json:async()=>({success:true,result:[{
   success:true,results:rows
  }]})};
 }};
}
const collect=(db,opts={})=>{
 const m=mock(db,opts);
 return {collector:collectSixCallD1ReadOnly({
  d1ReadToken:'test-read-token-for-offline',fetchImpl:m.fetchImpl,
  clock:()=>now}),requests:m.queries};
};
test('generated from actual local SQLite DDL, pinned sha256 matches all seven objects',async()=>{
 const f=schema();try{
  const actual=Object.fromEntries(f.rows.map(({name,sql})=>[
   name,createHash('sha256').update(sql).digest('hex')
  ]));
  // Printed once in offline CI so final reviewed manifest can pin exactly
  // the DDL SQLite itself stores, rather than a guessed reformatting.
  console.log('REVIEWED_SIX_CALL_DDL_SHA256_MANIFEST',JSON.stringify(actual));
  assert.equal(f.rows.length,7);
  assert.deepEqual(actual,D1_SMOKE_EXPECTED_DDL_SHA256);
  assert.equal(await attestSixCallD1SqlDefinitions(f.rows),true);
 }finally{f.db.close();}
});
test('actual pinned SQLite DDL passes remote SELECT-only evidence review',async()=>{
 const f=schema();try{
  const {collector,requests}=collect(f.db);
  const r=await collector;
  assert.equal(r.status,'MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED');
  assert.equal(r.sqlDefinitionsVerified,true);
  assert.equal(r.authorizesD1Writes,false);
  assert.equal(r.authorizesInference,false);
  assert.deepEqual(requests,[D1_SCHEMA_SELECT,D1_STATE_SELECT]);
 }finally{f.db.close();}
});
test('modified trigger logic with same object name and type is REJECTED',async()=>{
 const f=schema();try{
  const {collector,requests}=collect(f.db,{changeRows:rows=>
   rows.map(x=>x.name==='swarm_smoke_control_claim_atomic'?
    {...x,sql:x.sql.replace('reserved=reserved+1','reserved=reserved+2')}:x)});
  const r=await collector;
  assert.equal(r.reason,'D1_SQLITE_CONTROL_DDL_MISMATCH_OR_UNPINNED');
  assert.deepEqual(requests,[D1_SCHEMA_SELECT]);
 }finally{f.db.close();}
});
test('weakening output digest length with the same output table identity is rejected',async()=>{
 const f=schema();try{
  const {collector}=collect(f.db,{changeRows:rows=>
   rows.map(x=>x.name==='swarm_smoke_control_outputs'?
    {...x,sql:x.sql.replace('CHECK(length(digest_sha256)=64)',
      'CHECK(length(digest_sha256)=1)')}:x)});
  const r=await collector;
  assert.equal(r.reason,'D1_SQLITE_CONTROL_DDL_MISMATCH_OR_UNPINNED');
 }finally{f.db.close();}
});
test('weakening CHECK attempt limit with same table identity is rejected',async()=>{
 const f=schema();try{
  const {collector}=collect(f.db,{changeRows:rows=>
   rows.map(x=>x.name==='swarm_smoke_control_runs'?
    {...x,sql:x.sql.replace('attempts BETWEEN 0 AND 6','attempts BETWEEN 0 AND 999')}:x)});
  const r=await collector;
  assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesInference,false);
 }finally{f.db.close();}
});
test('NULL, absent, duplicated, reordered and extra schema SQL blocks',async()=>{
 const f=schema();try{
  for(const changeRows of [
   rows=>rows.map(x=>({...x,sql:null})),
   rows=>rows.slice(1),
   rows=>[...rows,rows[0]],
   rows=>rows.map(x=>({...x,sql:x.sql+' '})),
   rows=>rows.map(x=>({...x,sql:x.sql.replace('CREATE','ALTER')}))
  ]){
   const {collector}=collect(f.db,{changeRows});
   assert.equal((await collector).status,'BLOCKED');
  }
  const reversed=[...f.rows].reverse();
  assert.equal(await attestSixCallD1SqlDefinitions(reversed),true);
 }finally{f.db.close();}
});
test('malicious query caller and fake hash do not create inference authority',async()=>{
 const f=schema();try{
  const {collector}=collect(f.db);
  const r=await collector;
  assert.equal(r.authorizesDeployment,false);
  assert.equal(r.authorizesLiveActions,false);
  assert.equal(r.authorizesInference,false);
  assert.equal(typeof D1_SMOKE_EXPECTED_DDL_SHA256.swarm_smoke_control_claim_atomic,'string');
 }finally{f.db.close();}
});
