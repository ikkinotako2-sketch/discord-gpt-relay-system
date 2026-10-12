// OFFLINE-STAGED Workers AI adapter. Never imported by the existing production Worker.
// Exactly one model invocation per tick with a pre-claim budget gate.
import {claimStage,commitStage,failStage,waitForQuota,resumeAfterQuota,peekRunnableTask,buildStageMessages} from './engine.mjs';
import {GPT_OSS_MODEL,extractLoopFinalText} from '../loop-quality.mjs';

export async function runOneSwarmStep({db,ai,budgetCheck,now=Date.now(),leaseOwner=crypto.randomUUID()}){
  if(!db?.prepare||typeof ai?.run!=='function')throw Error('Swarm bindings unavailable');
  // Do not poll provider quotas when there is nothing queued. This keeps idle cron cheap.
  const waiting=await peekRunnableTask(db,now);
  if(!waiting)return {status:'idle'};
  // Fail CLOSED unless an explicitly provided allowance monitor confirms capacity.
  if(typeof budgetCheck!=='function')return {status:'blocked',reason:'BUDGET_MONITOR_MISSING'};
  let budget;
  try{budget=await budgetCheck({runId:waiting.run_id,ownerId:waiting.owner_id,model:GPT_OSS_MODEL});}
  catch{return {status:'blocked',reason:'BUDGET_MONITOR_ERROR'};}
  if(budget!=='allowed'){
    if(budget==='quota_wait'&&waiting.status==='queued')await waitForQuota(db,now);
    return {status:'blocked',reason:budget==='quota_wait'?'QUOTA_WAIT':'BUDGET_DENIED'};
  }
  if(waiting.status==='quota_wait'){
    // Resume only once an authorized provider has actually reported allowance.
    const resumed=await resumeAfterQuota(db,waiting.run_id,waiting.owner_id,now);
    if(!resumed.resumed)return {status:'idle'};
  }
  const claim=await claimStage(db,now,leaseOwner);
  if(!claim)return {status:'idle'};
  const {stage,modelInstructions,userText}=buildStageMessages(claim);
  let output;
  try{
    const result=await ai.run(GPT_OSS_MODEL,{
      messages:[{role:'system',content:modelInstructions},{role:'user',content:userText}],
      max_tokens:360,reasoning_effort:'low',temperature:0.2
    });
    output=extractLoopFinalText(result);
  }catch{
    // A model request may have been billed before it failed; never blindly retry.
    try {await failStage(db,claim,'MODEL_OUTCOME_UNKNOWN',Date.now());}catch{}
    return {status:'unknown',role:stage.id};
  }
  try{
    const persisted=await commitStage(db,claim,output,Date.now());
    return {status:persisted.status,role:stage.id,callsUsed:claim.calls_used};
  }catch{
    // DB commit could have succeeded despite connection failure. Do not retry.
    return {status:'unknown',role:stage.id,reason:'COMMIT_UNCONFIRMED'};
  }
}
