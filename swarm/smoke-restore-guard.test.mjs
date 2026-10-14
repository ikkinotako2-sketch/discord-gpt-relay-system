import test from 'node:test';
import assert from 'node:assert/strict';
import {decideSmokeRestore,DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
const base='18c379e8-e759-4b2f-8300-e7a4c8b39b83',smoke='3245153e-3281-48e8-a625-0a951d989501';
const now=Date.UTC(2026,9,13,4,0,0),expires=now+5*60*1000;
const binding=(name,text)=>({name,type:'plain_text',text});
const enabled=[...FLAGS.map(name=>binding(name,'true')),binding('SWARM_DAILY_CALL_CAP','6'),binding('SWARM_SMOKE_EXPIRES_AT',String(expires))];
const off=[...FLAGS.map(name=>binding(name,'false'))];
const setup=(overrides={})=>({...DISCORD_SMOKE_TARGET,baselineVersion:base,smokeVersion:smoke,
 currentVersions:[smoke],bindings:enabled,expiryMs:expires,nowMs:expires+1000,...overrides});
test('strict account, Worker, and D1 target rejects unrelated resources',()=>{
 for(const prop of ['accountId','worker','databaseId']){
  const x=decideSmokeRestore(setup({[prop]:'unrelated'}));
  assert.equal(x.action,'BLOCKED');
 }
});
test('only distinct known version IDs are accepted',()=>{
 for(const v of ['',base,'invalid']){
  assert.equal(decideSmokeRestore(setup({smokeVersion:v})).allowed,false);
 }
});
test('exact smoke version after deadline authorizes only restoring known baseline',()=>{
 const x=decideSmokeRestore(setup());
 assert.deepEqual(x,{allowed:true,action:'RESTORE_BASELINE',version:base});
});
test('before deadline, watchdog must not restore, but owner can emergency restore',()=>{
 assert.equal(decideSmokeRestore(setup({nowMs:now})).action,'WAIT');
 assert.equal(decideSmokeRestore(setup({nowMs:now,ownerEmergency:true})).action,'RESTORE_BASELINE');
});
test('unknown live version or split traffic blocks rollback to avoid overwriting another operator',()=>{
 for(const currentVersions of [[smoke,base],['02347faa-73a9-4e6b-a35f-a21d68795221'],[],['unknown']])
  assert.equal(decideSmokeRestore(setup({currentVersions})).action,'BLOCKED');
});
test('a verified OFF baseline is idempotent, but not if remote flags are enabled',()=>{
 assert.equal(decideSmokeRestore(setup({currentVersions:[base],bindings:off})).action,'ALREADY_OFF');
 assert.equal(decideSmokeRestore(setup({currentVersions:[base],bindings:enabled})).action,'BLOCKED');
});
test('smoke version must carry all exact enabled flags and hard cap six',()=>{
 for(const key of FLAGS){
  const mutated=enabled.map(x=>x.name===key?binding(key,'false'):x);
  assert.equal(decideSmokeRestore(setup({bindings:mutated})).action,'BLOCKED',key);
 }
 assert.equal(decideSmokeRestore(setup({bindings:enabled.map(x=>x.name==='SWARM_DAILY_CALL_CAP'?binding(x.name,'18'):x)})).action,'BLOCKED');
});
test('deadline must be exact and match remote configured absolute expiry',()=>{
 for(const bad of [undefined,'junk',expires-1,expires+1000])
  assert.equal(decideSmokeRestore(setup({expiryMs:bad})).action,'BLOCKED');
});
test('duplicate flags and secrets masquerading as plain values block restoration',()=>{
 assert.equal(decideSmokeRestore(setup({bindings:[...enabled,enabled[0]]})).action,'BLOCKED');
 assert.equal(decideSmokeRestore(setup({bindings:[{name:FLAGS[0],type:'secret_text'},...enabled.slice(1)]})).action,'BLOCKED');
});
test('incomplete or missing remote metadata cannot authorize any deployment action',()=>{
 for(const input of [{bindings:undefined},{bindings:[]},{currentVersions:undefined},{nowMs:NaN}])
  assert.equal(decideSmokeRestore(setup(input)).allowed,false);
});
