import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createDurableLoop, getLatestLoop, requestDurableStop, expireStaleClaims,
  claimOneLoopStep, commitLoopOutput, failLoopClaim
} from './loop-d1.mjs';

const owner='123456789012345678';
const other='223456789012345678';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./db/migrations/0001_discord_loop_jobs.sql', import.meta.url),'utf8'));
  const d1 = {
    prepare(sql) {
      const stmt=sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() {return stmt.get(...args) ?? null;},
            async run() {const r=stmt.run(...args);return {meta:{changes:r.changes}};},
            async all() {return {results:stmt.all(...args)};}
          };
        }
      };
    }
  };
  return {sqlite,d1};
}

test('D1 schema isolates one active run and validates replay',async()=>{
  const {d1}=setup();
  assert.deepEqual(await createDurableLoop(d1,{runId:'d1',requesterId:owner,task:'Safe project'}),{created:true,runId:'d1'});
  assert.deepEqual(await createDurableLoop(d1,{runId:'d1',requesterId:owner,task:'Safe project'}),{created:false,runId:'d1'});
  const busy=await createDurableLoop(d1,{runId:'d2',requesterId:other,task:'Another project'});
  assert.equal(busy.busy,true);
  assert.equal((await getLatestLoop(d1,owner)).status,'queued');
  assert.equal(await getLatestLoop(d1,other),null);
});

test('D1 persists four steps with exact handoff and finishes', async()=>{
  const {d1,sqlite}=setup(); const now=1000000;
  await createDurableLoop(d1,{runId:'d3',requesterId:owner,task:'Safe sample',now});
  for(let i=0;i<4;i++){
    const claimed=await claimOneLoopStep(d1,now+1000*(i+1),'lease-'+i);
    assert.ok(claimed);
    assert.equal(claimed.calls_used,i+1);
    assert.equal(claimed.next_role,i%2===0?'planner':'builder');
    if(i===2)assert.equal(claimed.previous_artifact,'output-2');
    const r=await commitLoopOutput(d1,claimed,'output-'+(i+1),now+1000*(i+1));
    assert.equal(r.status,i===3?'completed':'queued');
  }
  assert.equal(await claimOneLoopStep(d1,now+9999,'extra'),null);
  const row=sqlite.prepare('SELECT * FROM relay_loop_jobs WHERE run_id=?').get('d3');
  assert.equal(row.calls_used,4);
  assert.equal(row.previous_artifact,'output-4');
  assert.equal(JSON.parse(row.history_json).length,4);
  assert.equal(row.active_slot,null);
  assert.equal((await getLatestLoop(d1,owner)).status,'completed');
});

test('STOP queued prevents any model call and opens active slot',async()=>{
  const {d1}=setup();
  await createDurableLoop(d1,{runId:'d4',requesterId:owner,task:'Task',now:1000});
  const r=await requestDurableStop(d1,owner,2000);
  assert.equal(r.status,'stopped');
  assert.equal(await claimOneLoopStep(d1,2001,'lease'),null);
  assert.equal((await getLatestLoop(d1,owner)).status,'stopped');
  assert.equal((await createDurableLoop(d1,{runId:'d5',requesterId:other,task:'Next task',now:2002})).created,true);
});

test('STOP during claimed inference discards late output',async()=>{
  const {d1}=setup();
  await createDurableLoop(d1,{runId:'d6',requesterId:owner,task:'Task',now:1000});
  const claim=await claimOneLoopStep(d1,1500,'lease-1');
  assert.equal((await requestDurableStop(d1,owner,1600)).status,'stop_requested');
  assert.equal((await commitLoopOutput(d1,claim,'late model response',1700)).status,'stopped');
  const row=await getLatestLoop(d1,owner);
  assert.equal(row.status,'stopped');
  assert.equal(row.previous_artifact,null);
  assert.equal(row.calls_used,1);
});

test('expired claim becomes UNKNOWN, and never starts another model',async()=>{
  const {d1,sqlite}=setup();
  await createDurableLoop(d1,{runId:'d7',requesterId:owner,task:'Task',now:1000});
  const claimed=await claimOneLoopStep(d1,1500,'lease-2');
  await expireStaleClaims(d1,1500+5*60*1000+1);
  assert.equal((await getLatestLoop(d1,owner)).status,'unknown');
  assert.equal(await claimOneLoopStep(d1,1500+5*60*1000+2,'lease-3'),null);
  assert.equal((await commitLoopOutput(d1,claimed,'late',1500+5*60*1000+2)).status,'unknown');
  assert.equal(sqlite.prepare('SELECT calls_used FROM relay_loop_jobs WHERE run_id=?').get('d7').calls_used,1);
});

test('provider failure fails safely and never retries',async()=>{
  const {d1}=setup();
  await createDurableLoop(d1,{runId:'d8',requesterId:owner,task:'Task',now:1000});
  const claim=await claimOneLoopStep(d1,1500,'lease-4');
  assert.equal(await failLoopClaim(d1,claim,'MODEL_ERROR',1800),true);
  assert.equal((await getLatestLoop(d1,owner)).status,'failed');
  assert.equal(await claimOneLoopStep(d1,1900,'lease-5'),null);
});

test('invalid model output fails and releases slot',async()=>{
  const {d1}=setup();
  await createDurableLoop(d1,{runId:'d9',requesterId:owner,task:'Task',now:1000});
  const claim=await claimOneLoopStep(d1,1500,'lease-6');
  const r=await commitLoopOutput(d1,claim,'',1800);
  assert.equal(r.status,'failed');
  assert.equal((await getLatestLoop(d1,owner)).last_error_code,'INVALID_MODEL_OUTPUT');
});

test('input validation and authorization require a snowflake',async()=>{
  const {d1}=setup();
  await assert.rejects(()=>createDurableLoop(d1,{runId:'d10',requesterId:'not-id',task:'Hi'}),TypeError);
  await assert.rejects(()=>createDurableLoop(d1,{runId:'../../oops',requesterId:owner,task:'Hi'}),TypeError);
  await assert.rejects(()=>createDurableLoop(d1,{runId:'d10',requesterId:owner,task:' '}),TypeError);
  await assert.rejects(()=>requestDurableStop(d1,'bad'),TypeError);
  assert.equal(await getLatestLoop(d1,owner),null);
});

test('expired queued jobs are stopped and cleanup removes old data',async()=>{
  const {d1,sqlite}=setup();
  const start=1000;
  await createDurableLoop(d1,{runId:'d11',requesterId:owner,task:'Private example',now:start});
  await expireStaleClaims(d1,start+24*60*60*1000+1);
  assert.equal(sqlite.prepare('SELECT * FROM relay_loop_jobs WHERE run_id=?').get('d11'),undefined);
});

test('a second claim while in progress returns null',async()=>{
  const {d1}=setup();
  await createDurableLoop(d1,{runId:'d12',requesterId:owner,task:'Task',now:1000});
  const c=await claimOneLoopStep(d1,1100,'l1');
  assert.ok(c);
  assert.equal(await claimOneLoopStep(d1,1200,'l2'),null);
  assert.equal((await getLatestLoop(d1,owner)).calls_used,1);
});
