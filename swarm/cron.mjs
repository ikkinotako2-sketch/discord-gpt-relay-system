// STAGED ONLY. Call this from a future, separately approved Discord-only Cron hook.
// Not wired to existing production Discord commands or scheduled events.
import {runOneSwarmStep} from './runner.mjs';
import {parseDailyCap,reserveDailyFreeCall} from './quota.mjs';
const ownerOK=x=>typeof x==='string'&&/^\d{15,22}$/.test(x);
export async function runConfiguredSwarmTick(env,{now=Date.now(),leaseOwner=crypto.randomUUID()}={}){
 if(env?.SWARM_API_ENABLED!=='true'||env?.SWARM_RUNNER_ENABLED!=='true'||
   env?.SWARM_EXECUTION_APPROVED!=='true')return {status:'disabled'};
 if(!env?.LOOP_DB?.prepare||!env?.AI?.run||!ownerOK(String(env?.DISCORD_ALLOWED_USER_ID??'')))
   return {status:'blocked',reason:'DEDICATED_BINDINGS_MISSING'};
 let cap;
 try{cap=parseDailyCap(env.SWARM_DAILY_CALL_CAP);}
 catch{return {status:'blocked',reason:'DAILY_BUDGET_NOT_CONFIGURED'};}
 // Only allow tasks submitted under the existing exact Discord owner ID.
 const ownerId=String(env.DISCORD_ALLOWED_USER_ID);
 return runOneSwarmStep({
   db:env.LOOP_DB,ai:env.AI,now,leaseOwner,
   budgetCheck:async (job)=>{
     if(job.ownerId!==ownerId)return 'denied';
     return reserveDailyFreeCall(env.LOOP_DB,{ownerId,cap,now});
   }
 });
}
