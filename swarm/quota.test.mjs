import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {utcDay,parseDailyCap,reserveDailyFreeCall,ownerDailyUsage} from './quota.mjs';
const OWNER='123456789012345678';
const start=Date.UTC(2026,9,12,2);
function dbFixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 return {prepare(s){const q=sql.prepare(s);return{bind(...a){return{
  first:async()=>q.get(...a)||null,
  all:async()=>({results:q.all(...a)}),
  run:async()=>({meta:{changes:q.run(...a).changes}})
 }}}}};
}
test('UTC day is deterministic and cap must be explicitly bounded',()=>{
 assert.equal(utcDay(start),'2026-10-12');
 assert.equal(utcDay(start+86400000),'2026-10-13');
 for(const c of [0,'0',-1,19,'100','test',null,1.3])assert.throws(()=>parseDailyCap(c));
 assert.equal(parseDailyCap('3'),3);
});
test('atomic reservations cannot exceed daily call budget',async()=>{
 const db=dbFixture();
 const outcomes=await Promise.all(Array.from({length:8},()=>reserveDailyFreeCall(db,{ownerId:OWNER,cap:3,now:start})));
 assert.equal(outcomes.filter(x=>x==='allowed').length,3);
 assert.equal(outcomes.filter(x=>x==='quota_wait').length,5);
 assert.equal((await ownerDailyUsage(db,{ownerId:OWNER,now:start})).reserved,3);
});
test('a new UTC day resets local allowance, not a provider account quota',async()=>{
 const db=dbFixture();
 assert.equal(await reserveDailyFreeCall(db,{ownerId:OWNER,cap:1,now:start}),'allowed');
 assert.equal(await reserveDailyFreeCall(db,{ownerId:OWNER,cap:1,now:start+1000}),'quota_wait');
 assert.equal(await reserveDailyFreeCall(db,{ownerId:OWNER,cap:1,now:start+86400000}),'allowed');
});
test('lowering an existing cap cannot silently increase reservations',async()=>{
 const db=dbFixture();
 await reserveDailyFreeCall(db,{ownerId:OWNER,cap:3,now:start});
 assert.equal(await reserveDailyFreeCall(db,{ownerId:OWNER,cap:1,now:start+2000}),'quota_wait');
 assert.equal((await ownerDailyUsage(db,{ownerId:OWNER,now:start})).reserved,1);
});
test('invalid owner or unavailable D1 fails closed',async()=>{
 const db=dbFixture();
 await assert.rejects(()=>reserveDailyFreeCall(db,{ownerId:'other',cap:1,now:start}),TypeError);
 await assert.rejects(()=>reserveDailyFreeCall({}, {ownerId:OWNER,cap:1,now:start}),TypeError);
});
