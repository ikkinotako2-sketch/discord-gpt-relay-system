import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {ROLES,stageAt,validateCycles,createTask,claimStage,commitStage,failStage,requestStop,
  waitForQuota,resumeAfterQuota,expireClaims,buildStageMessages,ownerSnapshot} from './engine.mjs';
const OWNER='123456789012345678',OTHER='223456789012345678';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  return {db:{prepare(text){
    const stmt=sql.prepare(text);
    return {bind(...args){return {
      first:async()=>stmt.get(...args)||null,
      all:async()=>({results:stmt.all(...args)}),
      run:async()=>({meta:{changes:stmt.run(...args).changes}})
    }}};
  }},sql};
}
test('six fixed role names, cycle caps and stage mapping',()=>{
  assert.deepEqual(ROLES.map(x=>x.id),['director','researcher','developer','reviewer','improver','archivist']);
  assert.equal(stageAt(5).id,'archivist');
  assert.equal(stageAt(6).cycle,2);
  assert.throws(()=>stageAt(18),RangeError);
  assert.throws(()=>validateCycles(4),RangeError);
});
test('only one active job; same run ID is idempotent',async()=>{
  const {db}=fixture();
  assert.equal((await createTask(db,{runId:'a',ownerId:OWNER,task:'task',now:100})).status,'created');
  assert.equal((await createTask(db,{runId:'a',ownerId:OWNER,task:'task',now:100})).status,'existing');
  assert.equal((await createTask(db,{runId:'b',ownerId:OTHER,task:'task',now:100})).status,'busy');
});
test('one claim per step and final checkpoint saved after six stages',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'job1',ownerId:OWNER,task:'Make a draft',now:100});
  for(let n=0;n<6;n++){
    const claim=await claimStage(db,200+n*100,'lease_'+n);
    assert.equal(buildStageMessages(claim).stage.id,ROLES[n].id);
    const result=await commitStage(db,claim,'done_'+n,250+n*100);
    assert.equal(result.status,n===5?'completed':'queued');
  }
  assert.equal(await claimStage(db,1000,'lease_more'),null);
  const snap=await ownerSnapshot(db,OWNER);
  assert.equal(snap.jobs[0].callsUsed,6);
  assert.equal(snap.jobs[0].history.length,6);
  assert.equal(snap.jobs[0].lastCheckpoint,'done_5');
});
test('up to three bounded cycles can complete (18 calls)',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'job2',ownerId:OWNER,task:'Improve',cycles:3,now:100});
  for(let n=0;n<18;n++){
    const claim=await claimStage(db,200+n*100,'lease_'+n);
    assert.equal((await commitStage(db,claim,'done_'+n,250+n*100)).status,n===17?'completed':'queued');
  }
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].callsMax,18);
});
test('quota pause prevents claim until authorized resume',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'quota',ownerId:OWNER,task:'Task',now:100});
  assert.equal(await waitForQuota(db,110),true);
  assert.equal(await claimStage(db,120,'lease1'),null);
  assert.deepEqual(await resumeAfterQuota(db,'quota',OTHER,125),{resumed:false});
  assert.deepEqual(await resumeAfterQuota(db,'quota',OWNER,125),{resumed:true});
  assert.ok(await claimStage(db,130,'lease2'));
  assert.equal(await waitForQuota(db,135),false);
});
test('STOP rejects in-flight result; no further calls',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'stop',ownerId:OWNER,task:'Task',now:100});
  const claim=await claimStage(db,150,'lease');
  assert.equal((await requestStop(db,OWNER,155)).status,'stop_requested');
  assert.equal((await commitStage(db,claim,'should be discarded',160)).status,'stopped');
  assert.equal(await claimStage(db,180,'lease2'),null);
});
test('expired claim becomes UNKNOWN with no blind retry',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'unknown',ownerId:OWNER,task:'Task',now:100});
  await claimStage(db,150,'lease');
  await expireClaims(db,5*60*1000+200);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'unknown');
  assert.equal(await claimStage(db,5*60*1000+300,'lease2'),null);
});
test('provider exception state becomes terminal unknown',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'err',ownerId:OWNER,task:'Task',now:100});
  const claim=await claimStage(db,150,'lease');
  await failStage(db,claim,'MODEL_OUTCOME_UNKNOWN',160);
  assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'unknown');
});
test('owner data never exposed to another user',async()=>{
  const {db}=fixture();
  await createTask(db,{runId:'secret',ownerId:OWNER,task:'Private',now:100});
  assert.equal((await ownerSnapshot(db,OTHER)).jobs.length,0);
  await assert.rejects(()=>ownerSnapshot(db,'not-owner'),TypeError);
});
