import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const legacy=readFileSync(new URL('../db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8');
const swarm=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const executable=swarm.split('\n').filter(s=>!s.trim().startsWith('--')).join('\n');

test('six-role migration contains ONLY two additive tables and two indexes',()=>{
 assert.doesNotMatch(executable,/\b(?:DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|ATTACH|DETACH)\b/i);
 assert.deepEqual([...executable.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(x=>x[1]),
 ['swarm_jobs','swarm_budget_days']);
 assert.deepEqual([...executable.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)/g)].map(x=>x[1]),
 ['swarm_single_active_job','swarm_owner_created']);
 assert.doesNotMatch(executable,/CREATE (?:UNIQUE )?INDEX\s+(?!IF NOT EXISTS)/i);
});
test('additive schema can run twice without changing the existing Discord relay table',()=>{
 const sql=new DatabaseSync(':memory:');
 try{
   sql.exec(legacy);
   const before=sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relay_loop_jobs'").get().sql;
   sql.exec(swarm);
   sql.exec(swarm);
   const after=sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relay_loop_jobs'").get().sql;
   assert.equal(after,before);
   const objs=sql.prepare("SELECT name,type FROM sqlite_master WHERE name IN ('swarm_jobs','swarm_budget_days','swarm_single_active_job','swarm_owner_created') ORDER BY name").all();
   assert.deepEqual(objs.map(x=>[x.name,x.type]),[
     ['swarm_budget_days','table'],['swarm_jobs','table'],
     ['swarm_owner_created','index'],['swarm_single_active_job','index']
   ]);
 }finally{sql.close();}
});
test('swarm unique active-slot constraint prevents parallel agent jobs',()=>{
 const sql=new DatabaseSync(':memory:');
 try{
   sql.exec(swarm);
   const insert=sql.prepare("INSERT INTO swarm_jobs (run_id,owner_id,task,cycles,active_slot,created_at,updated_at,expires_at) VALUES (?,?,?,1,1,?,?,?)");
   insert.run('one','123456789012345678','task',1,1,10);
   assert.throws(()=>insert.run('two','123456789012345678','task',1,1,10));
   const x=sql.prepare("SELECT COUNT(*) AS count FROM swarm_jobs WHERE active_slot=1").get();
   assert.equal(x.count,1);
 }finally{sql.close();}
});
