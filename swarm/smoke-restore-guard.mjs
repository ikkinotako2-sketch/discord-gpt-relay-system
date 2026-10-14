// PURE, OFFLINE-ONLY release decision logic. No Cloudflare, GitHub, DB or network writes.
// This module does NOT schedule an auto-OFF task or perform a restore.
export const DISCORD_SMOKE_TARGET=Object.freeze({
 accountId:'6c8ccd6aface937ab5dabef61cb64534',
 worker:'steep-glitter-b5cddiscord-ai-relay-lab',
 databaseId:'d80b08a4-0ff7-4320-9575-0d3c55cf7aba'
});
export const FLAGS=Object.freeze(['SWARM_API_ENABLED','SWARM_RUNNER_ENABLED','SWARM_EXECUTION_APPROVED','SWARM_EXCLUSIVE_MODE']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied=(reason)=>({allowed:false,action:'BLOCKED',reason});
function plain(bindings,name){
 const found=bindings.filter(x=>x?.name===name);
 if(found.length>1)return {invalid:true};
 if(found.length===0)return {value:null};
 if(found[0].type!=='plain_text'||typeof found[0].text!=='string')return {invalid:true};
 return {value:found[0].text};
}
/**
 * Bound a future ONLY-owner-authorized baseline-version restore. This function
 * is pure and cannot deploy or change settings. Caller must independently
 * validate API token scope, free quota, concurrency freeze and the version's
 * exact bindings, and must verify actual post-restore OFF state.
 */
export function decideSmokeRestore({accountId,worker,databaseId,baselineVersion,smokeVersion,
 currentVersions,bindings,expiryMs,nowMs=Date.now(),ownerEmergency=false}={}){
 if(accountId!==DISCORD_SMOKE_TARGET.accountId || worker!==DISCORD_SMOKE_TARGET.worker ||
    databaseId!==DISCORD_SMOKE_TARGET.databaseId)return denied('WRONG_DISCORD_RESOURCE');
 if(!uuid.test(baselineVersion||'')||!uuid.test(smokeVersion||'')||
    baselineVersion===smokeVersion)return denied('UNVERIFIED_DISTINCT_VERSION_PAIR');
 // Reject split deployments or another operator's new version: no blind overwrite.
 if(!Array.isArray(currentVersions)||currentVersions.length!==1||
    !uuid.test(currentVersions[0]||''))return denied('ACTIVE_VERSION_UNVERIFIED');
 if(!Array.isArray(bindings))return denied('REMOTE_BINDINGS_UNVERIFIED');
 const vals=Object.fromEntries([...FLAGS,'SWARM_DAILY_CALL_CAP','SWARM_SMOKE_EXPIRES_AT']
  .map(name=>[name,plain(bindings,name)]));
 if(Object.values(vals).some(x=>x.invalid))return denied('REMOTE_BINDING_AMBIGUOUS');
 const current=currentVersions[0];
 if(current===baselineVersion){
  if(FLAGS.every(k=>vals[k].value===null||vals[k].value==='false'))
    return {allowed:true,action:'ALREADY_OFF'};
  return denied('BASELINE_WITH_ENABLED_FLAGS');
 }
 if(current!==smokeVersion)return denied('UNEXPECTED_LIVE_WORKER_VERSION');
 if(!FLAGS.every(k=>vals[k].value==='true'))return denied('SMOKE_FLAGS_UNVERIFIED');
 if(vals.SWARM_DAILY_CALL_CAP.value!=='6')return denied('SMOKE_CAP_NOT_SIX');
 if(typeof expiryMs!=='number'||!Number.isSafeInteger(expiryMs)||
    !/^\d{13}$/.test(String(expiryMs))||vals.SWARM_SMOKE_EXPIRES_AT.value!==String(expiryMs))
    return denied('SMOKE_ABSOLUTE_EXPIRY_UNVERIFIED');
 if(!Number.isFinite(nowMs))return denied('TIME_UNVERIFIED');
 if(!ownerEmergency && nowMs<expiryMs)return {allowed:false,action:'WAIT',reason:'SMOKE_NOT_EXPIRED'};
 return {allowed:true,action:'RESTORE_BASELINE',version:baselineVersion};
}
