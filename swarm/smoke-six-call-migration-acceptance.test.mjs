import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {D1_SMOKE_EXPECTED_DDL_SHA256} from './smoke-six-call-d1-ddl-digest.mjs';
import {D1_SCHEMA_SELECT} from './smoke-six-call-d1-readonly-audit.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,27,10);
const owner='123456789012345678';
const RUN='offline_backup_run_20261027';
const receipt='offline_owner_receipt_20261027';
const v0='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const v1='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const script=file=>readFileSync(new URL('./'+file,import.meta.url),'utf8');
function legacy(db){
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(script('schema.sql'));
 db.prepare(`INSERT INTO swarm_jobs(
   run_id,owner_id,task,cycles,status,calls_used,last_error,
   created_at,updated_at,expires_at)
 VALUES(?,?,?,1,'unknown',1,?,?,?,?)`).run(
  'old_immutable_unknown',owner,'preserved_original_task',
  'MODEL_OUTCOME_UNKNOWN',now-10000,now-9000,now+120000);
}
const orig=db=>db.prepare(`SELECT * FROM swarm_jobs WHERE run_id='old_immutable_unknown'`).get();
const migration=db=>{
 db.exec(script('smoke-six-call-d1-schema.review.sql'));
 db.exec(script('smoke-six-call-owner-prepare-index.review.sql'));
 db.exec(script('smoke-six-call-output-artifacts.review.sql'));
};
function attest(db){
 const r=db.prepare(D1_SCHEMA_SELECT).all();
 assert.equal(r.length,7);
 const actual=Object.fromEntries(r.map(x=>[
  x.name,createHash('sha256').update(x.sql).digest('hex')
 ]));
 assert.deepEqual(actual,D1_SMOKE_EXPECTED_DDL_SHA256);
 return actual;
}
const integrity=db=>db.prepare('PRAGMA integrity_check').get().integrity_check;
function add(db,run=RUN,phase='ACTIVE',ownerId=owner){
 return db.prepare(`INSERT INTO swarm_smoke_control_runs(
  run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
  baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(run,ownerId,run+'_receipt',
  T.accountId,T.worker,T.databaseId,v0,v1,phase,now,now,now+18*60000);
}
test('proposed review SQL migration leaves original legacy UNKNOWN and D1 integrity untouched',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);const original=orig(db);
  assert.equal(integrity(db),'ok');
  migration(db);attest(db);
  assert.equal(integrity(db),'ok');
  assert.deepEqual(orig(db),original);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM swarm_smoke_control_runs`).get().n,0);
 }finally{db.close();}
});
test('migration is idempotent; repeated CREATE IF NOT EXISTS does not rewrite old objects',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);const old=orig(db);
  migration(db);const a=attest(db);
  migration(db);const b=attest(db);
  assert.deepEqual(b,a);assert.deepEqual(orig(db),old);
  assert.equal(integrity(db),'ok');
 }finally{db.close();}
});
test('local SQLite file VACUUM backup survives migration and restores original history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'discord-offline-restore-'));
 const dbFile=join(dir,'original.sqlite'),backup=join(dir,'readonly-backup.sqlite');
 try{
  const db=new DatabaseSync(dbFile);legacy(db);
  const old=orig(db);
  // Local test SQLite file, not the production D1 or a Cloudflare API.
  db.exec(`VACUUM INTO '${backup}'`);
  migration(db);attest(db);
  db.close();
  const recovered=new DatabaseSync(backup);
  try{
   assert.deepEqual(orig(recovered),old);
   assert.equal(integrity(recovered),'ok');
   assert.equal(recovered.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
    WHERE name='swarm_smoke_control_runs'`).get().n,0);
  }finally{recovered.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('atomic UNIQUE pending/open review slot prevents two simultaneously active controllers',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);migration(db);const old=orig(db);
  add(db,RUN,'PENDING');
  assert.throws(()=>add(db,'another_pending_review','ACTIVE'));
  assert.throws(()=>add(db,'another_pending_review','PENDING'));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM swarm_smoke_control_runs`).get().n,1);
  assert.deepEqual(orig(db),old);
 }finally{db.close();}
});
test('failed claim trigger rolls back the inserted claim AND the local daily budget',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);migration(db);add(db);
  const day='2026-10-27';
  db.prepare(`INSERT INTO swarm_budget_days(owner_id,utc_day,cap,reserved,updated_at)
  VALUES(?,?,?,?,?)`).run(owner,day,1,1,now);
  assert.throws(()=>db.prepare(`INSERT INTO swarm_smoke_control_claims(
    run_id,stage_index,owner_id,utc_day,claimed_at_ms) VALUES(?,?,?,?,?)`)
   .run(RUN,0,owner,day,now+1));
  const b=db.prepare(`SELECT reserved FROM swarm_budget_days
   WHERE owner_id=? AND utc_day=?`).get(owner,day);
  assert.equal(b.reserved,1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM swarm_smoke_control_claims`).get().n,0);
  const s=db.prepare(`SELECT attempts,revision FROM swarm_smoke_control_runs`).get();
  assert.equal(s.attempts,0);assert.equal(s.revision,0);
 }finally{db.close();}
});
test('STOP owner must never clear or amend immutable historical UNKNOWN',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);migration(db);const original=orig(db);
  add(db);
  db.prepare(`UPDATE swarm_smoke_control_runs SET stop_requested=1,
   phase='RESTORE_REQUIRED' WHERE run_id=?`).run(RUN);
  assert.deepEqual(orig(db),original);
  assert.equal(db.prepare(`SELECT stop_requested FROM swarm_smoke_control_runs
   WHERE run_id=?`).get(RUN).stop_requested,1);
 }finally{db.close();}
});
test('pinned DDL detects weakened cap even when object NAME remains unchanged',()=>{
 const db=new DatabaseSync(':memory:');try{
  legacy(db);migration(db);
  db.exec(`DROP TRIGGER swarm_smoke_control_claim_atomic`);
  db.exec(`CREATE TRIGGER swarm_smoke_control_claim_atomic AFTER INSERT
   ON swarm_smoke_control_claims BEGIN SELECT 1; END`);
  const sql=db.prepare(`SELECT sql FROM sqlite_master
   WHERE name='swarm_smoke_control_claim_atomic'`).get().sql;
  const digest=createHash('sha256').update(sql).digest('hex');
  assert.notEqual(digest,D1_SMOKE_EXPECTED_DDL_SHA256.swarm_smoke_control_claim_atomic);
  assert.deepEqual(orig(db)?.status,'unknown');
 }finally{db.close();}
});
test('review-only SQL files are never registered in any deploy workflow',()=>{
 const ddl=script('smoke-six-call-d1-schema.review.sql');
 const pending=script('smoke-six-call-owner-prepare-index.review.sql');
 assert.match(ddl,/OFFLINE-REVIEW-ONLY/);
 assert.match(pending,/OFFLINE-REVIEW/);
 assert.doesNotMatch(ddl,/\b(DROP TABLE|DELETE FROM swarm_jobs)\b/i);
 assert.doesNotMatch(pending,/\b(DROP TABLE|DELETE FROM swarm_jobs)\b/i);
});
