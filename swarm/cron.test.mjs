import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runConfiguredSwarmTick} from './cron.mjs';
import {createTask,ownerSnapshot} from './engine.mjs';
const OWNER='123456789012345678',DAY=Date.UTC(2026,9,12,1);
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(s){const stmt=sql.prepare(s);return{bind(...a){return{
  first:async()=>stmt.get(...a)||null,
  all:async()=>({results:stmt.all(...a)}),
  run:async()=>({meta:{changes:stmt.run(...a).changes}})
 }}}}};
 let calls=0;
 const env={LOOP_DB:db,AI:{run:async()=>{calls++;return {response:'stage-confirmed-'+calls}}},
 SWARM_API_ENABLED:'true',SWARM_RUNNER_ENABLED:'true',SWARM_EXECUTION_APPROVED:'true',SWARM_EXCLUSIVE_MODE:'true',
 DISCORD_ALLOWED_USER_ID:OWNER,SWARM_DAILY_CALL_CAP:'1'};
 return {db,env,calls:()=>calls};
}
test('all three execution consent flags must be present',async()=>{
 const {env,calls}=fixture();
 for(const flag of ['SWARM_API_ENABLED','SWARM_RUNNER_ENABLED','SWARM_EXECUTION_APPROVED','SWARM_EXCLUSIVE_MODE']){
  assert.equal((await runConfiguredSwarmTick({...env,[flag]:'false'}, {now:DAY})).status,'disabled');
 }
 assert.equal(calls(),0);
});
test('no configured local cap blocks inference',async()=>{
 const {env,calls,db}=fixture();
 await createTask(db,{runId:'job',ownerId:OWNER,task:'work',now:DAY});
 const out=await runConfiguredSwarmTick({...env,SWARM_DAILY_CALL_CAP:'notset'},{now:DAY+5});
 assert.equal(out.reason,'DAILY_BUDGET_NOT_CONFIGURED');
 assert.equal(calls(),0);
});
test('one allowed inference per day, then quota wait and next-day automatic continuation',async()=>{
 const {env,calls,db}=fixture();
 await createTask(db,{runId:'job',ownerId:OWNER,task:'work',now:DAY});
 const a=await runConfiguredSwarmTick(env,{now:DAY+5,leaseOwner:'l1'});
 assert.equal(a.status,'queued');
 const b=await runConfiguredSwarmTick(env,{now:DAY+10000,leaseOwner:'l2'});
 assert.equal(b.reason,'QUOTA_WAIT');
 assert.equal(calls(),1);
 assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].status,'quota_wait');
 const c=await runConfiguredSwarmTick(env,{now:DAY+86400000,leaseOwner:'l3'});
 assert.equal(c.status,'queued');
 assert.equal(calls(),2);
 assert.equal((await ownerSnapshot(db,OWNER)).jobs[0].callsUsed,2);
});
test('runner blocks tasks owned by any other Discord user',async()=>{
 const {env,calls,db}=fixture();
 await createTask(db,{runId:'foreign',ownerId:'223456789012345678',task:'work',now:DAY});
 const response=await runConfiguredSwarmTick(env,{now:DAY+5});
 assert.equal(response.reason,'BUDGET_DENIED');
 assert.equal(calls(),0);
});

test('six-call smoke window halts Cron after expiry regardless of unused daily quota',async()=>{
 const {env,db,calls}=fixture();
 const smoke={...env,SWARM_DAILY_CALL_CAP:'6',
   SWARM_SMOKE_EXPIRES_AT:String(DAY+2*60*1000)};
 await createTask(db,{runId:'smoke_job',ownerId:OWNER,task:'safe test task',now:DAY});
 const one=await runConfiguredSwarmTick(smoke,{now:DAY+1000,leaseOwner:'smoke1'});
 assert.equal(one.status,'queued');
 assert.equal(calls(),1);
 const overdue=await runConfiguredSwarmTick(smoke,{now:DAY+2*60*1000,leaseOwner:'smoke2'});
 assert.equal(overdue.status,'disabled');
 assert.equal(calls(),1,'expired smoke cap may not consume any more tokens');
});
