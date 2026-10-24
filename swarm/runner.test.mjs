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


test('provider invocation failure stays terminal UNKNOWN and is not retried',async()=>{
  const db=fixture();
  await createTask(db,{runId:'phase_invoke',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;throw Error('provider secrets and arbitrary text must never be logged')}};
  const result=await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:200,leaseOwner:'lease'});
  assert.equal(result.status,'unknown');
  assert.equal(calls,1);
  const job=(await ownerSnapshot(db,OWNER)).jobs[0];
  assert.equal(job.status,'unknown');
  assert.equal(job.callsUsed,1);
  assert.equal(job.lastCheckpoint,'');
});
test('unparseable model completion also stays terminal UNKNOWN and reserves one call',async()=>{
  const db=fixture();
  await createTask(db,{runId:'phase_parse',ownerId:OWNER,task:'test',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;return {output:[{type:'reasoning',summary:[]}]}}};
  const result=await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:200,leaseOwner:'lease'});
  assert.equal(result.status,'unknown');
  assert.equal(calls,1);
  const job=(await ownerSnapshot(db,OWNER)).jobs[0];
  assert.equal(job.status,'unknown');
  assert.equal(job.callsUsed,1);
  assert.equal(job.lastCheckpoint,'');
});

test('idle cron must not consume budget-monitor checks or inference',async()=>{
  const db=fixture();let monitored=0,called=0;
  const result=await runOneSwarmStep({db,ai:{run:async()=>{called++;return {response:'ok'};}},
    budgetCheck:async()=>{monitored++;return 'allowed'},now:100});
  assert.equal(result.status,'idle');
  assert.equal(monitored,0);
  assert.equal(called,0);
});
test('quota-paused job automatically continues only after legitimate allowance returns',async()=>{
  const db=fixture();await createTask(db,{runId:'auto_resume',ownerId:OWNER,task:'draft',now:100});
  let calls=0;
  const ai={run:async()=>{calls++;return {response:'confirmed result'}}};
  await runOneSwarmStep({db,ai,budgetCheck:async()=> 'quota_wait',now:110});
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'quota_wait');
  const result=await runOneSwarmStep({db,ai,budgetCheck:async()=> 'allowed',now:120,leaseOwner:'safe_resume'});
  assert.equal(result.status,'queued');
  assert.equal(calls,1);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].lastCheckpoint,'confirmed result');
});
test('budget monitor outage never claims an AI step',async()=>{
  const db=fixture();await createTask(db,{runId:'monitor_down',ownerId:OWNER,task:'draft',now:100});
  const result=await runOneSwarmStep({db,ai:{run:async()=>{throw Error('must not run')}},
    budgetCheck:async()=>{throw Error('service offline')},now:110});
  assert.equal(result.reason,'BUDGET_MONITOR_ERROR');
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].callsUsed,0);
});
