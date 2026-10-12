// Command Center v0: owner-scoped, read-only D1 projection.
// This file is NOT wired into the currently deployed Discord Worker.
// Real requests must first pass authenticated Discord OAuth login.
const VALID_STATES=new Set(['queued','claimed','completed','stopped','failed','unknown']);
export const AGENT_LABELS=Object.freeze({
  planner:'AI A / Planner',
  builder:'AI B / Builder',
});
function validUser(userId){
  if(typeof userId!=='string'||!/^\d{15,22}$/.test(userId))throw new TypeError('Invalid owner id');
  return userId;
}
export function stageOrder(maxRounds=2) {
  const count=Math.min(2,Math.max(1,Number.isInteger(maxRounds)?maxRounds:2));
  return Array.from({length:count*2},(_,i)=>({
    step:i+1,round:Math.floor(i/2)+1,
    role:i%2?'builder':'planner',
    agent:AGENT_LABELS[i%2?'builder':'planner'],
  }));
}
export function projectLoopJob(row,{includeHistory=false}={}){
  if(!row||typeof row.run_id!=='string'||!VALID_STATES.has(row.status))throw TypeError('Invalid D1 loop job');
  const maxRounds=row.max_rounds===1?1:2;
  const steps=stageOrder(maxRounds);
  const calls=Math.max(0,Math.min(steps.length,Number(row.calls_used)||0));
  let history=[];
  if(includeHistory){
    try{
      const parsed=JSON.parse(row.history_json||'[]');
      if(Array.isArray(parsed))history=parsed
        .filter(h=>h&&['planner','builder'].includes(h.role)&&[1,2].includes(h.round))
        .slice(0,4)
        .map(h=>({role:h.role,round:h.round,text:String(h.output||'').slice(0,1200)}));
    }catch{history=[];}
  }
  const decorated=steps.map(s=>({
    ...s,
    status:s.step>calls?'pending':
      (row.status==='claimed'&&s.step===calls?'running':
       history.some(h=>h.round===s.round&&h.role===s.role)||s.step<calls?'completed':
       row.status==='completed'?'completed':'unknown'),
  }));
  return {
    id:row.run_id,
    status:row.status,
    task:String(row.task||'').slice(0,1000),
    callsUsed:calls,
    callsMax:steps.length,
    roundsMax:maxRounds,
    stopRequested:row.stop_requested===1,
    currentRole:row.next_role==='planner'||row.next_role==='builder'?row.next_role:null,
    agentSequence:decorated,
    history,
    finalResult:row.status==='completed'?String(row.previous_artifact||'').slice(0,2000):null,
    errorCode:row.last_error_code?String(row.last_error_code).slice(0,80):null,
    createdAt:Number(row.created_at)||0,
    updatedAt:Number(row.updated_at)||0,
  };
}
export async function listOwnerLoopJobs(db,ownerId,{limit=8,includeHistory=false}={}){
  validUser(ownerId);
  if(!db?.prepare)throw Error('Dedicated Discord D1 required');
  if(!Number.isInteger(limit)||limit<1||limit>20)throw RangeError('Limit must be 1..20');
  const fetched=await db.prepare(`SELECT run_id,task,status,next_role,round_number,max_rounds,
    calls_used,stop_requested,previous_artifact,history_json,last_error_code,created_at,updated_at
    FROM relay_loop_jobs WHERE requester_discord_id=? ORDER BY created_at DESC LIMIT ?`)
    .bind(ownerId,limit).all();
  if(!Array.isArray(fetched?.results))throw Error('Invalid D1 response');
  return fetched.results.map(row=>projectLoopJob(row,{includeHistory}));
}
export async function getOwnerDashboardSnapshot(db,ownerId,{includeHistory=false}={}){
  const jobs=await listOwnerLoopJobs(db,ownerId,{includeHistory});
  const active=jobs.find(j=>['queued','claimed'].includes(j.status));
  return {
    schema:'ai-relay-dashboard.v1',
    status:active?'active':'idle',
    activeJobs:active?1:0,
    jobs,
    agents:[{id:'planner',name:AGENT_LABELS.planner,modelGroup:'selected loop model'},
      {id:'builder',name:AGENT_LABELS.builder,modelGroup:'selected loop model'}],
    concurrencyLimit:1,
    maxRounds:2,
    maxModelCalls:4,
    refreshRecommendedSeconds:15,
    note:'These are two agent roles in a model relay, not two consumer ChatGPT conversations.',
  };
}
