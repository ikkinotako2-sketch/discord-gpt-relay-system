import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordSmokeReleaseFence} from './smoke-six-call-release-fence.mjs';
import {DISCORD_SMOKE_TARGET as target} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,26,11,0);
const expiry=now+19*60*1000;
const ownerReceiptId='oauth_receipt_20261026';
const baselineVersion='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smokeVersion='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const reviewedHeadSha='908ba6ab2760f7d70b105f1bdd70197b8cb3b93c';
const scope=()=>({target,ownerReceiptId,baselineVersion,
 smokeVersion,reviewedHeadSha,expiresAtMs:expiry});
function durable(){
 const state=new Map();let gate=Promise.resolve();
 let failPut=false,failRead=false;
 const storage={
  async get(k){if(failRead)throw Error('DURABLE_READ_FAILED');return state.get(k);},
  async transaction(fn){
   const previous=gate;let release;
   gate=new Promise(r=>release=r);
   await previous;
   try{
    return await fn({
     get:async k=>state.get(k),
     put:async(k,v)=>{if(failPut)throw Error('DB_DISCONNECTED');state.set(k,v);}
    });
   }finally{release();}
  }
 };
 return {storage,state,breakPut:()=>{failPut=true;},
  breakRead:()=>{failRead=true;}};
}
const fence=(d,clock=()=>now)=>createDiscordSmokeReleaseFence({storage:d.storage,clock});
test('one exact one-time local release fence is stored and observable, never live authority',async()=>{
 const d=durable(),f=fence(d),s=scope();
 const created=await f.reserveOnce(s);
 assert.equal(created.status,'STAGED_FENCE_RESERVED');
 assert.equal(created.authorizesDeploy,false);
 assert.equal(created.authorizesInference,false);
 assert.equal(created.releaseLockIsGlobal,false);
 const inspected=await f.inspect(s);
 assert.equal(inspected.status,'STAGED_FENCE_OBSERVED');
 assert.equal(inspected.releaseLockIsGlobal,false);
 assert.equal(d.state.size,1);
});
test('concurrent launch attempts do not obtain two reservations',async()=>{
 const d=durable(),f=fence(d);
 const results=await Promise.all([f.reserveOnce(scope()),f.reserveOnce(scope()),
  f.reserveOnce(scope())]);
 assert.deepEqual(results.map(x=>x.status).sort(),[
  'BLOCKED','BLOCKED','STAGED_FENCE_RESERVED']);
 assert.equal(d.state.size,1);
});
test('replay even after expiry never re-arms a known or unknown smoke',async()=>{
 const d=durable();
 assert.equal((await fence(d).reserveOnce(scope())).status,'STAGED_FENCE_RESERVED');
 assert.equal((await fence(d,()=>expiry+1).reserveOnce({
  ...scope(),expiresAtMs:expiry+10*60*1000
 })).reason,'FENCE_ALREADY_RESERVED_OR_UNCERTAIN');
 assert.equal((await fence(d,()=>expiry+1).inspect(scope())).reason,
  'FENCE_UNCERTAIN_OR_EXPIRED');
});
test('wrong target, same version, invalid receipt/head and >20min TTL fail closed',async()=>{
 const d=durable(),f=fence(d);
 const bad=[
  {target:{...target,worker:'wrong'}},
  {smokeVersion:baselineVersion},{ownerReceiptId:'x'},
  {reviewedHeadSha:'bad'}, {expiresAtMs:now+21*60*1000},
  {expiresAtMs:now-1},
 ];
 for(const patch of bad)
  assert.equal((await f.reserveOnce({...scope(),...patch})).status,'BLOCKED');
 assert.equal(d.state.size,0);
});
test('other owner or changed version/head cannot inspect existing latch',async()=>{
 const d=durable(),f=fence(d);
 await f.reserveOnce(scope());
 for(const patch of [
  {ownerReceiptId:'different_owner_receipt'},
  {baselineVersion:'38c379e8-e759-4b2f-8300-e7a4c8b39b83'},
  {smokeVersion:'48c379e8-e759-4b2f-8300-e7a4c8b39b83'},
  {reviewedHeadSha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
  {expiresAtMs:expiry-1000}
 ])assert.equal((await f.inspect({...scope(),...patch})).status,'BLOCKED');
});
test('ambiguous external deploy marks the latch permanently uncertain',async()=>{
 const d=durable(),f=fence(d);
 await f.reserveOnce(scope());
 const marked=await f.markUncertain({ownerReceiptId});
 assert.equal(marked.status,'FENCE_MARKED_UNCERTAIN_NO_RETRY');
 assert.equal(marked.authorizesDeploy,false);
 assert.equal((await f.inspect(scope())).status,'BLOCKED');
 assert.equal((await f.reserveOnce(scope())).reason,'FENCE_ALREADY_RESERVED_OR_UNCERTAIN');
 assert.equal((await f.markUncertain({ownerReceiptId})).reason,
  'ALREADY_UNCERTAIN_NO_RETRY');
});
test('another owner cannot mark stored fence uncertain',async()=>{
 const d=durable(),f=fence(d);
 await f.reserveOnce(scope());
 assert.equal((await f.markUncertain({ownerReceiptId:'other_owner_receipt'})).status,'BLOCKED');
 assert.equal((await f.inspect(scope())).status,'STAGED_FENCE_OBSERVED');
});
test('storage read/write failure does not grant deployment or permit retries',async()=>{
 const d=durable(),f=fence(d);
 d.breakPut();
 const fail=await f.reserveOnce(scope());
 assert.equal(fail.reason,'DURABLE_RESERVATION_OUTCOME_UNCERTAIN_NO_RETRY');
 assert.equal(fail.authorizesDeploy,false);
 const b=durable(),g=fence(b);
 await g.reserveOnce(scope());b.breakRead();
 assert.equal((await g.inspect(scope())).reason,'DURABLE_READ_FAILED');
});
test('clock failures and missing DO storage block',async()=>{
 assert.throws(()=>createDiscordSmokeReleaseFence(),/DURABLE/);
 const f=fence(durable(),()=>{throw Error('clock')});
 assert.equal((await f.reserveOnce(scope())).reason,'CLOCK_UNVERIFIED');
});
test('fence is not a global lock against Dashboard/Wrangler/outside CI',async()=>{
 const d=durable(),f=fence(d);
 const r=await f.reserveOnce(scope());
 assert.equal(r.releaseLockIsGlobal,false);
 assert.equal(r.authorizesInference,false);
 assert.equal(r.authorizesDeploy,false);
});
