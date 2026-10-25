// STRICTLY OFFLINE one-shot transition simulator for future Discord six-role review.
// No fetch, Cloudflare, AI invocation, D1 SQL, I/O, timer or external action.
// Test events are MOCK evidence, NOT actual authorization or a production receipt.
// Always authorizesLiveActions:false. The historical UNKNOWN stays immutable.
import {HISTORICAL_UNKNOWN_FINGERPRINT as OLD}
 from './smoke-reviewed-unknown-safe-off.mjs';

const MAX_CALLS=6;
const TERMINAL=new Set(['COMPLETE','BLOCKED','RESTORED_WITH_UNKNOWN','RESTORED_INCOMPLETE']);
const phases=Object.freeze([
 'SAFE_OFF','WATCHDOG_PREARMED','NON_SERVING_VERSION_STAGED',
 'SWITCHED_ONCE','OWNER_TASK_AUTHENTICATED','MODEL_CLAIMED',
 'RESTORE_VERIFIED','COMPLETE','RESTORED_WITH_UNKNOWN',
 'RESTORED_INCOMPLETE','BLOCKED','UNCERTAIN_MANUAL_RECOVERY'
]);
const nonneg=x=>Number.isSafeInteger(x)&&x>=0;
const deny=(s,reason)=>({...s,phase:'BLOCKED',reason,authorizesLiveActions:false});
export const OFFLINE_PHASES=phases;
export function createOfflineOneShot({nowMs,expiryMs,maxCalls=6,
 previousUnknown=OLD}={}){
 const historical=previousUnknown&&typeof previousUnknown==='object'&&
  Object.entries(OLD).every(([k,v])=>previousUnknown[k]===v);
 if(!nonneg(nowMs)||nowMs<1e12||
  !nonneg(expiryMs)||expiryMs<=nowMs||expiryMs-nowMs>20*60*1000||
  maxCalls!==MAX_CALLS||!historical)
  return {phase:'BLOCKED',reason:'INVALID_OFFLINE_TEST_SCOPE',
   authorizesLiveActions:false};
 return Object.freeze({
  phase:'SAFE_OFF',nowMs,expiryMs,claims:0,completions:0,
  uncertain:false,switched:false,restoreSeen:false,
  originalUnknownPreserved:true,authorizesLiveActions:false,
  mode:'OFFLINE_SIMULATION_ONLY'
 });
}
function copy(state,changes){
 return Object.freeze({...state,...changes,authorizesLiveActions:false});
}
export function applyOfflineOneShotEvent(state,event,nowMs){
 if(!state||state.mode!=='OFFLINE_SIMULATION_ONLY'||state.authorizesLiveActions!==false)
  return {phase:'BLOCKED',reason:'UNTRUSTED_OR_NONOFFLINE_STATE',authorizesLiveActions:false};
 if(TERMINAL.has(state.phase))return deny(state,'TERMINAL_STATE_CANNOT_RESTART');
 if(!nonneg(nowMs)||nowMs<state.nowMs)
  return deny(state,'DEADLINE_OR_CLOCK_INVALID_MANUAL_REVIEW');
 if(event===null||typeof event!=='object'||event.mockEvidence!==true)
  return deny(state,'MOCK_EVENT_UNVERIFIED');
 const kind=event.kind;
 // A mock independently verified restore receipt can arrive AFTER the expiry.
 // It never executes a fallback API POST; no status is treated as 6/6 success
 // unless all six previous mock call finals were confirmed.
 if(kind==='MOCK_BASELINE_RESTORED'&&state.switched&&!state.restoreSeen&&
    nowMs<=state.expiryMs+20*60*1000&&
    ['SWITCHED_ONCE','OWNER_TASK_AUTHENTICATED','MODEL_CLAIMED',
     'UNCERTAIN_MANUAL_RECOVERY'].includes(state.phase)){
  return copy(state,{phase:'RESTORE_VERIFIED',restoreSeen:true,
   uncertain:state.uncertain||state.phase==='MODEL_CLAIMED',
   reason:state.phase==='MODEL_CLAIMED'?'INFLIGHT_MODEL_UNCERTAIN_DO_NOT_RETRY':
    (state.uncertain?'MODEL_OUTCOME_UNKNOWN_NO_RETRY':
     (state.completions===MAX_CALLS?null:'INCOMPLETE_SIX_CALL_ABORTED')),
   nowMs});
 }
 if(nowMs>state.expiryMs)
  return deny(state,'DEADLINE_OR_CLOCK_INVALID_MANUAL_REVIEW');
 // All actions here are fictional receipts: never drive a live side effect.
 if(state.phase==='SAFE_OFF'&&kind==='MOCK_WATCHDOG_PREARMED')
  return copy(state,{phase:'WATCHDOG_PREARMED',nowMs});
 if(state.phase==='WATCHDOG_PREARMED'&&kind==='MOCK_NON_SERVING_VERSION_STAGED')
  return copy(state,{phase:'NON_SERVING_VERSION_STAGED',nowMs});
 if(state.phase==='NON_SERVING_VERSION_STAGED'&&kind==='MOCK_TRAFFIC_SWITCH_CONFIRMED')
  return copy(state,{phase:'SWITCHED_ONCE',switched:true,nowMs});
 if(state.phase==='SWITCHED_ONCE'&&kind==='MOCK_NEW_OWNER_OAUTH_CSRF_TASK')
  return copy(state,{phase:'OWNER_TASK_AUTHENTICATED',nowMs});
 // Separately reserve one call *before* each simulated inference attempt.
 // Never recover a claimed call by reissuing its stage index.
 if(state.phase==='OWNER_TASK_AUTHENTICATED'&&kind==='MOCK_MODEL_CLAIM'){
  if(state.claims>=MAX_CALLS||state.completions!==state.claims||
     event.index!==state.claims)
   return deny(state,'SIMULATED_CLAIM_REPLAY_OR_CAP');
  return copy(state,{phase:'MODEL_CLAIMED',claims:state.claims+1,nowMs});
 }
 if(state.phase==='MODEL_CLAIMED'&&kind==='MOCK_MODEL_FINAL'){
  if(event.index!==state.claims-1||event.finalVerified!==true)
   return deny(state,'SIMULATED_RESULT_UNVERIFIED');
  const done=state.completions+1;
  return copy(state,{phase:done===MAX_CALLS?'SWITCHED_ONCE':'OWNER_TASK_AUTHENTICATED',
   completions:done,nowMs});
 }
 if(state.phase==='MODEL_CLAIMED'&&kind==='MOCK_PROVIDER_RESULT_UNKNOWN'){
  if(event.index!==state.claims-1)
   return deny(state,'SIMULATED_UNKNOWN_INDEX_INVALID');
  // Terminal, even if a provider may have run; NEVER rerun the stage.
  return copy(state,{phase:'UNCERTAIN_MANUAL_RECOVERY',uncertain:true,nowMs,
   reason:'MODEL_OUTCOME_UNKNOWN_NO_RETRY'});
 }
 if(state.phase==='RESTORE_VERIFIED'&&kind==='MOCK_WATCHDOG_PARKED')
  return copy(state,{phase:state.uncertain?'RESTORED_WITH_UNKNOWN':
    (state.completions===MAX_CALLS?'COMPLETE':'RESTORED_INCOMPLETE'),nowMs});
 return deny(state,'OUT_OF_ORDER_OR_UNRECOGNIZED_MOCK_EVENT');
}
// Pure report: never converts simulation into execution permission.
export function offlineOneShotSummary(state){
 return {status:state?.phase??'BLOCKED',mockClaims:state?.claims??0,
  mockCompletions:state?.completions??0,oldUnknownPreserved:state?.originalUnknownPreserved===true,
  authorizesLiveActions:false,warning:'SIMULATION_ONLY_NOT_PRODUCTION_AUTHORIZATION'};
}
