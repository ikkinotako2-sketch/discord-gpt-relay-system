// STAGED/OFFLINE ONLY: register an existing PENDING review's immutable task.
// NOT imported by the live Discord Worker or Command Center router.
// Does not activate smoke, deploy, call AI, modify old swarm_jobs or consent.
// Task text is supplied ONLY by a separately reviewed trusted server callback,
// NEVER by the caller's request body.
import {authenticateDashboard,dashboardConfigured,COMMAND_CENTER_ORIGIN}
 from '../command-center/server.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';

export const SMOKE_REVIEW_TASK_REGISTER_PATH=
 '/command-center/api/swarm/smoke/register-reviewed-task';
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const OWNER=/^[0-9]{15,22}$/;
const MILLIS=n=>Number.isSafeInteger(n)&&n>=1e12;
const HEADERS={
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY'
};
const respond=(status,code)=>new Response(JSON.stringify({
 status:code,authorizesInference:false,authorizesDeployment:false,
 authorizesD1Migration:false,authorizesWatchdogArming:false,
 authorizesLiveActions:false
}),{status,headers:HEADERS});
const constantEqual=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length>200||b.length>200)
  return false;
 let delta=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)
  delta|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return delta===0;
};
const safeOff=env=>
 FLAGS.every(flag=>env?.[flag]===undefined||env[flag]==='false')&&
 (env?.SWARM_DAILY_CALL_CAP===undefined||env.SWARM_DAILY_CALL_CAP==='6');
const SELECT_PENDING=`
 SELECT run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 phase,attempts,completed,revision,stop_requested,in_flight_index,
 created_at_ms,expires_at_ms
 FROM swarm_smoke_control_runs
 WHERE run_id=? AND owner_id=? LIMIT 1
`;
const INSERT_TASK=`
 INSERT INTO swarm_smoke_control_owner_tasks(
 run_id,owner_id,task_receipt_id,original_task,created_at_ms)
 SELECT run_id,owner_id,task_receipt_id,?,?
 FROM swarm_smoke_control_runs
 WHERE run_id=? AND owner_id=? AND task_receipt_id=?
  AND account_id=? AND worker_name=? AND database_id=?
  AND phase='PENDING' AND stop_requested=0
  AND attempts=0 AND completed=0 AND revision=0
  AND in_flight_index IS NULL
  AND created_at_ms<=? AND expires_at_ms>?
 RETURNING run_id,owner_id,task_receipt_id
`;
const READBACK=`
 SELECT t.run_id,t.owner_id,t.task_receipt_id,t.original_task,
 t.created_at_ms,r.phase,r.attempts,r.completed,r.stop_requested
 FROM swarm_smoke_control_owner_tasks t
 JOIN swarm_smoke_control_runs r ON r.run_id=t.run_id
 WHERE t.run_id=? LIMIT 1
`;
async function parseIntent(request){
 const contentLength=request.headers.get('Content-Length');
 if(contentLength!==null&&(!/^\d{1,3}$/.test(contentLength)||
   Number(contentLength)>256))return null;
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>256)return null;
 let body;try{body=JSON.parse(raw);}catch{return null;}
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='intent,runId'||
    body.intent!=='REGISTER_REVIEW_ONLY_TASK'||!ID.test(body.runId||''))
  return null;
 return body.runId;
}
function validTrustedTask(x,{runId,ownerId,taskReceiptId,now,expiry}){
 return x&&Object.keys(x).sort().join(',')===
  'checkedAtMs,kind,originalTask,ownerId,runId,taskReceiptId'&&
  x.kind==='SERVER_REVIEWED_ORIGINAL_TASK'&&
  x.runId===runId&&x.ownerId===ownerId&&
  x.taskReceiptId===taskReceiptId&&
  MILLIS(x.checkedAtMs)&&x.checkedAtMs<=now&&
  now-x.checkedAtMs<=5*60*1000&&
  now<expiry&&typeof x.originalTask==='string'&&
  x.originalTask.trim().length>=1&&
  x.originalTask.length<=1000&&
  new TextEncoder().encode(x.originalTask).byteLength<=2400;
}
/** Non-serving review-only entrypoint. A trusted server (not client HTTP)
 * must supply loadServerReviewedTask. Single INSERT SELECT and readback,
 * with no retry if an ambiguous D1 result could already be committed.
 */
export async function handleSmokeReviewedTaskRegister(request,env,{
 loadServerReviewedTask=null,clock=Date.now
}={}){
 let url;try{url=new URL(request?.url);}catch{return respond(404,'NOT_FOUND');}
 if(url.origin!==COMMAND_CENTER_ORIGIN||
    url.pathname!==SMOKE_REVIEW_TASK_REGISTER_PATH||
    url.search!==''||url.hash!=='')
  return respond(404,'NOT_FOUND');
 if(request.method!=='POST')return respond(405,'METHOD_NOT_ALLOWED');
 if(env?.SMOKE_OWNER_TASK_REGISTER_ENABLED!=='true'||!safeOff(env)||
    !dashboardConfigured(env)||typeof env?.LOOP_DB?.prepare!=='function'||
    typeof loadServerReviewedTask!=='function')
  return respond(503,'REVIEW_TASK_REGISTRATION_DISABLED');
 let now;try{now=clock();}catch{return respond(503,'CLOCK_UNVERIFIED');}
 if(!MILLIS(now))return respond(503,'CLOCK_UNVERIFIED');
 let session;try{session=await authenticateDashboard(request,env,now);}
 catch{return respond(401,'AUTH_REQUIRED');}
 if(!session||session.id!==String(env.DISCORD_ALLOWED_USER_ID)||!OWNER.test(session.id))
  return respond(401,'AUTH_REQUIRED');
 if(request.headers.get('Origin')!==COMMAND_CENTER_ORIGIN||
    request.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/json'||
    !constantEqual(request.headers.get('X-CSRF-Token'),session.csrf)||
    !['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))
  return respond(403,'ORIGIN_OR_CSRF_REJECTED');
 let runId;try{runId=await parseIntent(request);}catch{return respond(400,'INVALID_REVIEW_TASK_INTENT');}
 if(!runId)return respond(400,'INVALID_REVIEW_TASK_INTENT');
 const db=env.LOOP_DB;
 let pending;try{pending=await db.prepare(SELECT_PENDING).bind(runId,session.id).first();}
 catch{return respond(503,'PENDING_READ_UNVERIFIED');}
 if(!pending||pending.run_id!==runId||pending.owner_id!==session.id||
    !ID.test(pending.task_receipt_id||'')||
    pending.account_id!==DISCORD_SMOKE_TARGET.accountId||
    pending.worker_name!==DISCORD_SMOKE_TARGET.worker||
    pending.database_id!==DISCORD_SMOKE_TARGET.databaseId||
    pending.phase!=='PENDING'||pending.stop_requested!==0||
    pending.attempts!==0||pending.completed!==0||pending.revision!==0||
    pending.in_flight_index!==null||
    !MILLIS(pending.created_at_ms)||!MILLIS(pending.expires_at_ms)||
    now<pending.created_at_ms||now>=pending.expires_at_ms||
    pending.expires_at_ms-pending.created_at_ms>20*60*1000)
  return respond(409,'NO_ELIGIBLE_OWNER_PENDING_REVIEW');
 let task;try{
  task=await loadServerReviewedTask({
   runId,ownerId:session.id,taskReceiptId:pending.task_receipt_id,atMs:now
  });
 }catch{return respond(503,'SERVER_TASK_REVIEW_UNVERIFIED');}
 // A trusted review callback may complete after the initial request clock.
 // Validate its attestation against the post-await clock, never the older
 // pre-await timestamp (which would reject a legitimate fresh review).
 let postReview;try{postReview=clock();}catch{return respond(503,'CLOCK_UNVERIFIED');}
 if(!MILLIS(postReview)||postReview<now||postReview>=pending.expires_at_ms||
    postReview-now>30*1000)
  return respond(503,'REVIEW_WINDOW_EXPIRED');
 if(!validTrustedTask(task,{
  runId,ownerId:session.id,taskReceiptId:pending.task_receipt_id,
  now:postReview,expiry:pending.expires_at_ms
 }))return respond(503,'SERVER_TASK_REVIEW_UNVERIFIED');
 let saved;
 try{
  saved=await db.prepare(INSERT_TASK).bind(
   task.originalTask,postReview,runId,session.id,pending.task_receipt_id,
   DISCORD_SMOKE_TARGET.accountId,DISCORD_SMOKE_TARGET.worker,
   DISCORD_SMOKE_TARGET.databaseId,postReview,postReview
  ).first();
 }catch{return respond(503,'TASK_INSERT_UNCERTAIN_NO_RETRY');}
 if(saved?.run_id!==runId||saved.owner_id!==session.id||
    saved.task_receipt_id!==pending.task_receipt_id)
  return respond(503,'TASK_INSERT_UNVERIFIED_NO_RETRY');
 let row;try{row=await db.prepare(READBACK).bind(runId).first();}
 catch{return respond(503,'TASK_READBACK_UNVERIFIED_NO_RETRY');}
 if(!row||row.run_id!==runId||row.owner_id!==session.id||
    row.task_receipt_id!==pending.task_receipt_id||
    row.original_task!==task.originalTask||
    row.created_at_ms!==postReview||row.phase!=='PENDING'||
    row.stop_requested!==0||row.attempts!==0||row.completed!==0)
  return respond(503,'TASK_READBACK_UNVERIFIED_NO_RETRY');
 return respond(202,'IMMUTABLE_OWNER_TASK_REVIEW_RECORDED_NO_LIVE_AUTHORITY');
}
