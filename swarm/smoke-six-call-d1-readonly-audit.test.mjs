import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collectSixCallD1ReadOnly,D1_SCHEMA_SELECT,D1_STATE_SELECT,
 D1_CONTROL_SCHEMA_NAMES} from './smoke-six-call-d1-readonly-audit.mjs';
import {DISCORD_D1_URL} from './smoke-watchdog-d1.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,27,1,0);
const owner='123456789012345678';
const RUN='review_only_run_20261027';
const V1='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const V2='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const sqlText=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
function fixture({migrated=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(sqlText('schema.sql'));
 if(migrated){
  sqlite.exec(sqlText('smoke-six-call-d1-schema.review.sql'));
  sqlite.exec(sqlText('smoke-six-call-owner-prepare-index.review.sql'));
 }
 const queries=[];
 const fetchImpl=async(url,opts)=>{
  assert.equal(url,DISCORD_D1_URL);
  assert.equal(opts.method,'POST'); // REST method, SQL is read only
  assert.equal(opts.headers['Content-Type'],'application/json');
  assert.equal(opts.headers.Authorization,'Bearer test-read-only-token');
  const parsed=JSON.parse(opts.body);
  assert.deepEqual(Object.keys(parsed),['sql']);
  assert.equal(parsed.sql.slice(0,6),'SELECT');
  assert.ok([9,10,13,32].includes(parsed.sql.charCodeAt(6)));
  assert.doesNotMatch(parsed.sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE|PRAGMA|ATTACH)\b/i);
  queries.push(parsed.sql);
  let rows;
  try{rows=sqlite.prepare(parsed.sql).all();}
  catch{return {status:400,ok:false,json:async()=>({success:false})};}
  return {status:200,ok:true,json:async()=>({
   success:true,result:[{success:true,results:rows}]
  })};
 };
 return {sqlite,queries,fetchImpl};
}
function options(f){return {d1ReadToken:'test-read-only-token',fetchImpl:f.fetchImpl,
 clock:()=>now};}
test('unapplied migration is detected using ONE metadata SELECT',async()=>{
 const f=fixture();try{
  const result=await collectSixCallD1ReadOnly(options(f));
  assert.equal(result.status,'MIGRATION_UNAPPLIED_CONFIRMED');
  assert.equal(result.schemaObjectCount,0);
  assert.equal(result.sqlDefinitionsVerified,false);
  assert.equal(result.authorizesD1Writes,false);
  assert.equal(result.authorizesInference,false);
  assert.deepEqual(f.queries,[D1_SCHEMA_SELECT]);
 }finally{f.sqlite.close();}
});
test('complete proposed schema exists: still requires independent review',async()=>{
 const f=fixture({migrated:true});try{
  const result=await collectSixCallD1ReadOnly(options(f));
  assert.equal(result.status,'MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED',JSON.stringify(result));
  assert.equal(result.schemaObjectCount,D1_CONTROL_SCHEMA_NAMES.length);
  assert.deepEqual(f.queries,[D1_SCHEMA_SELECT,D1_STATE_SELECT]);
  assert.equal(result.counts.runs,0);
  assert.equal(result.counts.claim_rows,0);
  assert.equal(result.authorizesDeployment,false);
  assert.equal(result.originalHistoricalUnknownVerified,false);
 }finally{f.sqlite.close();}
});
test('new active smoke reservation detected without exposing owner/job payload',async()=>{
 const f=fixture({migrated:true});try{
  f.sqlite.prepare(`INSERT INTO swarm_smoke_control_runs
   (run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
   baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    RUN,owner,'receipt_claim_20261027',T.accountId,T.worker,T.databaseId,
    V1,V2,'ACTIVE',now,now,now+19*60*1000);
  f.sqlite.prepare(`INSERT INTO swarm_smoke_control_claims
   (run_id,stage_index,owner_id,utc_day,claimed_at_ms)
   VALUES(?,?,?,?,?)`).run(RUN,0,owner,'2026-10-27',now+10);
  const result=await collectSixCallD1ReadOnly(options(f));
  assert.equal(result.status,'CONTROL_JOBS_REQUIRE_MANUAL_REVIEW',JSON.stringify(result));
  assert.equal(result.counts.reserved_attempts,1);
  assert.equal(result.counts.in_flight_runs,1);
  assert.equal(result.counts.claimed_unresolved,1);
  assert.equal(result.authorizesInference,false);
  assert.equal(JSON.stringify(result).includes(owner),false);
  assert.equal(JSON.stringify(result).includes(RUN),false);
 }finally{f.sqlite.close();}
});
test('partial index or trigger migration must BLOCK and not query missing tables',async()=>{
 const f=fixture({migrated:true});try{
  f.sqlite.exec('DROP INDEX swarm_smoke_control_one_pending_or_open');
  const result=await collectSixCallD1ReadOnly(options(f));
  assert.equal(result.reason,'PARTIAL_D1_CONTROL_MIGRATION_UNSAFE');
  assert.deepEqual(f.queries,[D1_SCHEMA_SELECT]);
 }finally{f.sqlite.close();}
});
test('schema metadata duplication and object type mismatch block',async()=>{
 for(const change of [rows=>[...rows,rows[0]],
  rows=>rows.map((r,i)=>i===0?{...r,type:'view'}:r)]){
  const f=fixture({migrated:true});try{
   const result=await collectSixCallD1ReadOnly({
    ...options(f),fetchImpl:async(url,opts)=>{
     const orig=await f.fetchImpl(url,opts);const payload=await orig.json();
     if(JSON.parse(opts.body).sql===D1_SCHEMA_SELECT)
      payload.result[0].results=change(payload.result[0].results);
     return {...orig,json:async()=>payload};
    }
   });
   assert.equal(result.reason,'CONTROL_SCHEMA_NAMES_OR_TYPES_AMBIGUOUS');
  }finally{f.sqlite.close();}
 }
});
test('invalid credentials and clock fail before SELECT',async()=>{
 const f=fixture();try{
  for(const patch of [{d1ReadToken:null},{d1ReadToken:'x'},
   {fetchImpl:null},{clock:()=>0}]){
   assert.equal((await collectSixCallD1ReadOnly({...options(f),...patch})).status,'BLOCKED');
  }
  assert.equal(f.queries.length,0);
 }finally{f.sqlite.close();}
});
test('REST timeout, rate limit, corrupt JSON and SQL HTTP errors block',async()=>{
 for(const fetchImpl of [
  async()=>{throw Error('network offline')},
  async()=>({status:429,ok:false,json:async()=>({})}),
  async()=>({status:200,ok:true,json:async()=>{throw Error('bad json')}}),
  async()=>({status:200,ok:true,json:async()=>({success:true,result:[]})})
 ]){
  const x=await collectSixCallD1ReadOnly({d1ReadToken:'fake-private-read-token',
   fetchImpl,clock:()=>now});
  assert.equal(x.status,'BLOCKED');
  assert.equal(x.authorizesD1Writes,false);
 }
});
test('counter corruption and impossible >6 attempts are never treated as safe',async()=>{
 const base=fixture({migrated:true});try{
  const corruptions=[
   {claim_rows:1},{runs:1,reserved_attempts:7},
   {new_unknown:1},{in_flight_runs:1},
   {verified_finals:1},{runs:null},{runs:'0'}, {claimed_unresolved:-1},
   {verified_finals:0.5}
  ];
  for(const extra of corruptions){
   const result=await collectSixCallD1ReadOnly({
    ...options(base),fetchImpl:async(url,opts)=>{
     const r=await base.fetchImpl(url,opts);
     const body=await r.json();
     if(JSON.parse(opts.body).sql===D1_STATE_SELECT)
      body.result[0].results=[{...body.result[0].results[0],...extra}];
     return {...r,json:async()=>body};
    }
   });
   assert.equal(result.status,'BLOCKED');
  }
 }finally{base.sqlite.close();}
});
test('future or expired clock after collection blocks, no misleading safe response',async()=>{
 for(const end of [now-1,now+6*60*1000]){
  const f=fixture();try{
   let reads=0;
   const result=await collectSixCallD1ReadOnly({
    ...options(f),clock:()=>++reads===1?now:end
   });
   assert.equal(result.reason,'D1_EVIDENCE_STALE_OR_CLOCK_ROLLBACK');
  }finally{f.sqlite.close();}
 }
});
test('no original historical UNKNOWN row is read, repaired, or deleted',async()=>{
 const f=fixture({migrated:true});try{
  const old=f.sqlite.prepare('SELECT COUNT(*) as count FROM swarm_jobs').get().count;
  await collectSixCallD1ReadOnly(options(f));
  const current=f.sqlite.prepare('SELECT COUNT(*) as count FROM swarm_jobs').get().count;
  assert.equal(current,old);
  assert.equal(f.queries.some(q=>q.includes('swarm_jobs')),false);
 }finally{f.sqlite.close();}
});
