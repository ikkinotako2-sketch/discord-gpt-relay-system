import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createTask,claimStage,ownerSnapshot,resumeAfterQuota} from './engine.mjs';
import {runOneSwarmStep} from './runner.mjs';
const OWNER='123456789012345678';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const db={prepare(text){
    const stmt=sql.prepare(text);
    return {bind(...a){return {
      first:async()=>stmt.get(...a)||null,
      all:async()=>({results:stmt.all(...a)}),
      run:async()=>({meta:{changes:stmt.run(...a).changes}})
    }}};
  }};
  return db;
}
test('no budget monitor fails closed without a claim or model call',async()=>{
  const db=fixture();
  await createTask(db,{runId:'test1',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;return {response:'ok'}}};
  assert.deepEqual(await runOneSwarmStep({db,ai,now:200}),{status:'blocked',reason:'BUDGET_MONITOR_MISSING'});
  assert.equal(calls,0);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].callsUsed,0);
});
test('quota wait before claim does not spend any model calls',async()=>{
  const db=fixture();
  await createTask(db,{runId:'test2',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;return {response:'ok'}}};
  const result=await runOneSwarmStep({db,ai,budgetCheck:async()=> 'quota_wait',now:200});
  assert.equal(result.reason,'QUOTA_WAIT');
  assert.equal(calls,0);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'quota_wait');
  assert.deepEqual(await resumeAfterQuota(db,'test2',OWNER,250),{resumed:true});
});
test('allowed one-step tick invokes only one AI call and stores checkpoint',async()=>{
  const db=fixture();
  await createTask(db,{runId:'test3',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async(model,request)=>{calls++;
    assert.match(model,/gpt-oss-20b/);
    assert.equal(request.messages[0].role,'system');
    return {response:'stage complete'};
  }};
  const result=await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:200,leaseOwner:'lease'});
  assert.equal(result.status,'queued');assert.equal(result.role,'director');
  assert.equal(calls,1);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].lastCheckpoint,'stage complete');
});
test('ambiguous inference error is terminal unknown and never auto retried',async()=>{
  const db=fixture();
  await createTask(db,{runId:'test4',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;throw Error('rate limit or timeout')}};
  assert.equal((await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:200,leaseOwner:'lease'})).status,'unknown');
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'unknown');
  assert.equal((await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:250,leaseOwner:'lease2'})).status,'idle');
  assert.equal(calls,1);
});
