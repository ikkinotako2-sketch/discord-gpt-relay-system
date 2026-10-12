// OFFLINE STAGED: bridge for the independently approved six-role runner.
// No deployed route or Cron hook imports this module until a separate release.
// Four distinct opt-ins prevent the six-role runner from launching accidentally.
export function swarmModeEnabled(env,now=Date.now()) {
  const explicitlyApproved=env?.SWARM_API_ENABLED==='true'
    && env?.SWARM_RUNNER_ENABLED==='true'
    && env?.SWARM_EXECUTION_APPROVED==='true'
    && env?.SWARM_EXCLUSIVE_MODE==='true';
  if(!explicitlyApproved)return false;
  // The specifically approved cap-6 *smoke test* needs a short absolute
  // deadline, independent of GitHub Actions cleanup or an open browser.
  // After expiry, NO new six-role stage may be claimed or inferred.
  // This cannot cancel a model request already in flight.
  if(env?.SWARM_DAILY_CALL_CAP==='6'){
    const raw=env?.SWARM_SMOKE_EXPIRES_AT;
    if(typeof raw!=='string'||!/^\\d{13}$/.test(raw))return false;
    const expiry=Number(raw);
    if(!Number.isSafeInteger(expiry)||!Number.isFinite(now)||
       expiry<=now||expiry-now>20*60*1000)return false;
  }
  return true;
}
export function isSwarmRoute(pathname) {
  return pathname==='/command-center/swarm'
    || pathname==='/command-center/swarm/'
    || pathname.startsWith('/command-center/api/swarm/');
}

// A local free-call reservation is NOT a provider-neuron quota check.
// Legacy tasks always drain first; both owner task-creation paths must be
// disabled during EXCLUSIVE six-role mode to prevent new legacy jobs.
// Fail closed if we cannot confirm legacy D1 has no active tasks.
export async function runExclusiveScheduledTick(env,{runLegacy,runSwarm}={}) {
  if(typeof runLegacy!=='function'||typeof runSwarm!=='function')
    throw TypeError('Missing explicitly injected runner');
  const result=await runLegacy(env);
  if(!result||typeof result.status!=='string')throw Error('Legacy runner status unverified');
  if(result.status!=='idle')return {source:'legacy',...result};
  if(!swarmModeEnabled(env))return {source:'legacy',status:'idle'};
  if(!env?.LOOP_DB?.prepare)return {source:'swarm',status:'blocked',reason:'DEDICATED_DB_MISSING'};
  let row;
  try{
    row=await env.LOOP_DB.prepare(
      "SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE status IN ('queued','claimed') OR active_slot=1"
    ).bind().first();
  }catch{
    return {source:'swarm',status:'blocked',reason:'LEGACY_STATE_UNVERIFIED'};
  }
  if(!row||!Number.isSafeInteger(row.active_jobs)||row.active_jobs<0)
    return {source:'swarm',status:'blocked',reason:'LEGACY_STATE_UNVERIFIED'};
  if(row.active_jobs!==0)return {source:'swarm',status:'blocked',reason:'LEGACY_JOB_ACTIVE'};
  const next=await runSwarm(env);
  if(!next||typeof next.status!=='string')throw Error('Swarm runner status unverified');
  return {source:'swarm',...next};
}
