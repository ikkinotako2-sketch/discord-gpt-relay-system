import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {stageOrder,projectLoopJob,listOwnerLoopJobs,getOwnerDashboardSnapshot} from './command-center/data.mjs';
const OWNER='123456789012345678',OTHER='223456789012345678';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8'));
  const q=sql.prepare(`INSERT INTO relay_loop_jobs
    (run_id,requester_discord_id,task,status,next_role,round_number,max_rounds,
     calls_used,revision,history_json,stop_requested,active_slot,created_at,updated_at,expires_at,
     previous_artifact,last_error_code)
     VALUES (?,?,?,?,?,?,?,?,0,?,0,?,?,?,?,?,?)`);
  function add({id='job1',owner=OWNER,task='挨拶',status='completed',calls=4,
    history='[]',active=null,result='こんにちは',created=1000,role=null,error=null}={}){
    q.run(id,owner,task,status,role,2,2,calls,history,active,created,created,created+90000,result,error);
  }
  const db={
    prepare(text){
      const statement=sql.prepare(text);
      return {bind(...args){return {all:async()=>({results:statement.all(...args)})}}};
    }
  };
  return {add,db,sql};
}
test('two-agent four-stage sequence matches actual Cron runner',()=>{
  assert.deepEqual(stageOrder().map(x=>[x.role,x.round]),[
    ['planner',1],['builder',1],['planner',2],['builder',2]]);
  assert.equal(stageOrder(1).length,2);
});
test('owner dashboard returns final persisted result and four stages',async()=>{
  const f=fixture();f.add();
  const snapshot=await getOwnerDashboardSnapshot(f.db,OWNER);
  assert.equal(snapshot.status,'idle');
  assert.equal(snapshot.activeJobs,0);
  assert.equal(snapshot.jobs.length,1);
  assert.equal(snapshot.jobs[0].finalResult,'こんにちは');
  assert.equal(snapshot.jobs[0].callsUsed,4);
  assert.equal(snapshot.jobs[0].agentSequence.length,4);
});
test('owner cannot see another Discord owner data',async()=>{
  const f=fixture();f.add({owner:OTHER});
  assert.deepEqual(await listOwnerLoopJobs(f.db,OWNER),[]);
  assert.equal((await listOwnerLoopJobs(f.db,OTHER)).length,1);
});
test('queued model job is active and not falsely completed',async()=>{
  const f=fixture();f.add({status:'queued',calls:1,active:1,role:'builder'});
  const snapshot=await getOwnerDashboardSnapshot(f.db,OWNER);
  assert.equal(snapshot.status,'active');
  assert.equal(snapshot.activeJobs,1);
  assert.equal(snapshot.jobs[0].agentSequence[1].status,'pending');
});
test('claimed AI step shows in-progress without marking all complete',async()=>{
  const f=fixture();f.add({status:'claimed',calls:2,active:1,role:'builder'});
  const j=(await listOwnerLoopJobs(f.db,OWNER))[0];
  assert.equal(j.agentSequence[1].status,'running');
  assert.equal(j.agentSequence[3].status,'pending');
});
test('history is excluded by default and explicitly capped when requested',()=>{
  const row={run_id:'jobA',task:'my task',status:'completed',max_rounds:2,calls_used:4,
    history_json:JSON.stringify([{round:1,role:'planner',output:'planning'},
      {round:1,role:'builder',output:'writing'}]),previous_artifact:'finish'};
  assert.deepEqual(projectLoopJob(row).history,[]);
  const j=projectLoopJob(row,{includeHistory:true});
  assert.equal(j.history[0].text,'planning');
  assert.equal(j.agentSequence[0].status,'completed');
});
test('invalid owners, limits and malformed D1 data fail closed',async()=>{
  const f=fixture();f.add();
  await assert.rejects(()=>listOwnerLoopJobs(f.db,'not-discord-id'),TypeError);
  await assert.rejects(()=>listOwnerLoopJobs(f.db,OWNER,{limit:21}),RangeError);
  await assert.rejects(()=>listOwnerLoopJobs({},OWNER),/D1 required/);
  assert.throws(()=>projectLoopJob({run_id:'a',status:'hacked'}),TypeError);
});
test('D1 failures never become fake green statuses',async()=>{
  await assert.rejects(()=>getOwnerDashboardSnapshot({
    prepare:()=>({bind:()=>({all:async()=>{throw Error('database unavailable')}})})
  },OWNER),/database unavailable/);
});
