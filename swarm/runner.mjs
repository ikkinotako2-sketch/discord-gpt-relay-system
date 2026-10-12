// OFFLINE-STAGED Workers AI adapter. Never imported by the existing production Worker.
// Exactly one model invocation per tick with a pre-claim budget gate.
import {claimStage,commitStage,failStage,waitForQuota,buildStageMessages} from './engine.mjs';
import {GPT_OSS_MODEL,extractLoopFinalText} from '../loop-quality.mjs';

export async function runOneSwarmStep({db,ai,budgetCheck,now=Date.now(),leaseOwner=crypto.randomUUID()}){
  if(!db?.prepare||typeof ai?.run!=='function')throw Error('Swarm bindings unavailable');
  // Fail CLOSED unless an explicitly provided budget monitor confirms allowance.
  if(typeof budgetCheck!=='function')return {status:'blocked',reason:'BUDGET_MONITOR_MISSING'};
  const budget=await budgetCheck();
  if(budget!=='allowed'){
    if(budget==='quota_wait')await waitForQuota(db,now);
    return {status:'blocked',reason:budget==='quota_wait'?'QUOTA_WAIT':'BUDGET_DENIED'};
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
