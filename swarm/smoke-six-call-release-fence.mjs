// OFFLINE-STAGED one-time Discord smoke release fence using a Durable Object
// storage.transaction capability. This cannot lock unrelated Dashboard, Wrangler,
// CI or third-party deployment actions. It NEVER authorizes a release or inference.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const KEY='discord-six-call-release-fence-once-v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=/^[A-Za-z0-9_-]{8,100}$/;
const ms=x=>Number.isSafeInteger(x)&&x>=1e12;
const denies=(reason)=>Object.freeze({status:'BLOCKED',reason,authorizesDeploy:false,
 authorizesInference:false,releaseLockIsGlobal:false});
const exact=t=>t?.accountId===DISCORD_SMOKE_TARGET.accountId&&
 t.worker===DISCORD_SMOKE_TARGET.worker&&t.databaseId===DISCORD_SMOKE_TARGET.databaseId;
function inputOk(x,now){
 return exact(x?.target)&&id.test(x?.ownerReceiptId||'')&&
  uuid.test(x?.baselineVersion||'')&&uuid.test(x?.smokeVersion||'')&&
  x.baselineVersion!==x.smokeVersion&&
  /^[0-9a-f]{40}$/.test(x?.reviewedHeadSha||'')&&
  ms(now)&&ms(x?.expiresAtMs)&&x.expiresAtMs>now&&
  x.expiresAtMs-now<=20*60*1000;
}
function inspectRecord(r){
 return r&&r.schema==='discord-smoke-release-fence.v1'&&
  exact(r.target)&&uuid.test(r.baselineVersion||'')&&
  uuid.test(r.smokeVersion||'')&&id.test(r.ownerReceiptId||'')&&
  /^[0-9a-f]{40}$/.test(r.reviewedHeadSha||'')&&
  ms(r.createdAtMs)&&ms(r.expiresAtMs)&&
  r.expiresAtMs>r.createdAtMs&&r.expiresAtMs-r.createdAtMs<=20*60*1000&&
  (r.phase==='RESERVED'||r.phase==='UNCERTAIN')&&r.generation===1;
}
/**
 * The storage should be the SQLite-backed, single-instance Durable Object
 * state.storage; no HTTP adapter, deployment client or binding is provided.
 * Once stored, this code never allows a second reservation, even after expiry
 * or failed network calls; a human must separately prove the safe-OFF state.
 */
export function createDiscordSmokeReleaseFence({storage,clock=Date.now}={}){
 if(typeof storage?.transaction!=='function'||typeof storage?.get!=='function'||
    typeof clock!=='function')throw Error('DURABLE_RELEASE_FENCE_UNAVAILABLE');
 return Object.freeze({
  async reserveOnce(scope){
   let now;try{now=clock();}catch{return denies('CLOCK_UNVERIFIED');}
   if(!inputOk(scope,now))return denies('UNPINNED_FENCE_SCOPE_OR_DEADLINE');
   let response;
   try{
    response=await storage.transaction(async tx=>{
     const existing=await tx.get(KEY);
     if(existing!==undefined&&existing!==null)
      return denies('FENCE_ALREADY_RESERVED_OR_UNCERTAIN');
     const receipt=Object.freeze({
      schema:'discord-smoke-release-fence.v1',phase:'RESERVED',
      target:{...DISCORD_SMOKE_TARGET},baselineVersion:scope.baselineVersion,
      smokeVersion:scope.smokeVersion,ownerReceiptId:scope.ownerReceiptId,
      reviewedHeadSha:scope.reviewedHeadSha,
      createdAtMs:now,expiresAtMs:scope.expiresAtMs,generation:1
     });
     await tx.put(KEY,receipt);
     return {status:'STAGED_FENCE_RESERVED',generation:1};
    });
   }catch{return denies('DURABLE_RESERVATION_OUTCOME_UNCERTAIN_NO_RETRY');}
   return {...response,authorizesDeploy:false,authorizesInference:false,
    releaseLockIsGlobal:false};
  },
  async inspect(scope){
   let now;try{now=clock();}catch{return denies('CLOCK_UNVERIFIED');}
   if(!inputOk(scope,Math.min(now,scope?.expiresAtMs-1)))
    return denies('UNPINNED_FENCE_SCOPE_OR_DEADLINE');
   let record;
   try{record=await storage.get(KEY);}catch{return denies('DURABLE_READ_FAILED');}
   if(!inspectRecord(record))return denies('FENCE_MISSING_OR_INVALID');
   if(record.ownerReceiptId!==scope.ownerReceiptId||
      record.baselineVersion!==scope.baselineVersion||
      record.smokeVersion!==scope.smokeVersion||
      record.reviewedHeadSha!==scope.reviewedHeadSha||
      record.expiresAtMs!==scope.expiresAtMs)
    return denies('FENCE_SCOPE_MISMATCH');
   if(record.phase!=='RESERVED'||!ms(now)||now<record.createdAtMs||
      now>=record.expiresAtMs)
    return denies('FENCE_UNCERTAIN_OR_EXPIRED');
   // This records a local single-instance latch only. Never claim external
   // release serialization, especially against Dashboard/Wrangler.
   return {status:'STAGED_FENCE_OBSERVED',generation:1,
    authorizesDeploy:false,authorizesInference:false,releaseLockIsGlobal:false};
  },
  async markUncertain({ownerReceiptId}={}){
   if(!id.test(ownerReceiptId||''))return denies('INVALID_OWNER_RECEIPT');
   try{
    const r=await storage.transaction(async tx=>{
     const existing=await tx.get(KEY);
     if(!inspectRecord(existing)||existing.ownerReceiptId!==ownerReceiptId)
      return denies('NO_MATCHING_FENCE');
     if(existing.phase==='UNCERTAIN')return denies('ALREADY_UNCERTAIN_NO_RETRY');
     await tx.put(KEY,{...existing,phase:'UNCERTAIN'});
     return {status:'FENCE_MARKED_UNCERTAIN_NO_RETRY'};
    });
    return {...r,authorizesDeploy:false,authorizesInference:false,
     releaseLockIsGlobal:false};
   }catch{return denies('FENCE_OUTCOME_UNCERTAIN_NO_RETRY');}
  }
 });
}
