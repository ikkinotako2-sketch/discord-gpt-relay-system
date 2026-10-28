// OFFLINE STAGING ONLY: owner-authenticated REVIEW REQUEST (never AI approval).
// This route is not imported by the live Discord Worker or command-center router.
// Reuses existing Discord OAuth HMAC session verification + Origin/CSRF.
// No model invoke, no flags/deploy/Secrets modification and no existing-job writes.
import {authenticateDashboard,dashboardConfigured,COMMAND_CENTER_ORIGIN}
 from '../command-center/server.mjs';
import {makeSixCallCandidate} from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';

export const SMOKE_REVIEW_PREPARE_PATH='/command-center/api/swarm/smoke/prepare';
const MIME='application/json';
const RESPONSE_HEADERS={
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY'
};
const reply=(status,code,extra={})=>new Response(JSON.stringify({
 status:code,authorizesDeployment:false,authorizesInference:false,...extra
}),{status,headers:RESPONSE_HEADERS});
const ID=/^[A-Za-z0-9_-]{8,100}$/;
function equalConstantTime(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length>200||b.length>200)
  return false;
 let diff=a.length^b.length;
 const count=Math.max(a.length,b.length);
 for(let i=0;i<count;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return diff===0;
}
function exactSafeOffEnv(env){
 // Guard the runtime mode as an additional safety condition, not a proof of
 // actual remote Worker bindings or independent production release lock.
 return FLAGS.every(k=>env?.[k]===undefined||env[k]==='false')&&
    (env?.SWARM_DAILY_CALL_CAP===undefined||env.SWARM_DAILY_CALL_CAP==='6');
}
async function strictIntent(request){
 const reported=request.headers.get('Content-Length');
 if(reported!==null&&(!/^\d{1,3}$/.test(reported)||Number(reported)>256))
  return false;
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>256)return false;
 let value;try{value=JSON.parse(raw);}catch{return false;}
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===1&&value.intent==='REVIEW_ONLY_NO_LIVE_ACTIONS';
}
function exactPlan(p,nowMs){
 return p?.kind==='SERVER_PINNED_REVIEW_PLAN' &&
   p?.target?.accountId===DISCORD_SMOKE_TARGET.accountId &&
   p?.target?.worker===DISCORD_SMOKE_TARGET.worker &&
   p?.target?.databaseId===DISCORD_SMOKE_TARGET.databaseId &&
   Number.isSafeInteger(p.checkedAtMs)&&p.checkedAtMs<=nowMs &&
   nowMs-p.checkedAtMs<=5*60*1000 &&
   Number.isSafeInteger(p.expiresAtMs);
}
const INSERT_PENDING=`
INSERT INTO swarm_smoke_control_runs(
 run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?, 'PENDING',?,?,?)
 RETURNING run_id
`;
const CHECK_EXISTING=`
SELECT run_id FROM swarm_smoke_control_runs
 WHERE phase IN ('PENDING','ACTIVE','RESTORE_REQUIRED') LIMIT 1
`;

/**
 * Owner can only PREPARE one pending review request; it cannot mark ACTIVE.
 * Only a separately reviewed trusted server plan can supply pinned versions.
 * Caller HTTP JSON can supply exactly one non-authorizing review-only intent.
 * Production integration will require separate signed source and release
 * attestation; a mock test plan is never evidence of live authorization.
 */
export async function handleSmokeOwnerPrepare(request,env,{
 loadReviewedPlan=null,
 idFactory=()=>crypto.randomUUID().replaceAll('-',''),
 clock=Date.now
}={}){
 let url;try{url=new URL(request?.url);}catch{return reply(404,'NOT_FOUND');}
 if(url.origin!==COMMAND_CENTER_ORIGIN||
    url.pathname!==SMOKE_REVIEW_PREPARE_PATH||
    url.search!==''||url.hash!=='')
   return reply(404,'NOT_FOUND');
 if(request.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
 if(env?.SMOKE_OWNER_PREPARE_ENABLED!=='true'||
    !dashboardConfigured(env)||!exactSafeOffEnv(env))
  return reply(503,'PREPARE_DISABLED');
 let now;
 try{now=clock();}catch{return reply(503,'CLOCK_UNVERIFIED');}
 if(!Number.isSafeInteger(now)||now<1e12)return reply(503,'CLOCK_UNVERIFIED');
 let session;
 try{session=await authenticateDashboard(request,env,now);}
 catch{return reply(401,'AUTH_REQUIRED');}
 if(!session||session.id!==String(env.DISCORD_ALLOWED_USER_ID))
  return reply(401,'AUTH_REQUIRED');
 const origin=request.headers.get('Origin');
 if(origin!==COMMAND_CENTER_ORIGIN ||
    request.headers.get('Content-Type')?.split(';')[0]?.trim()!==MIME||
    !equalConstantTime(request.headers.get('X-CSRF-Token'),session.csrf)||
    !['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))
  return reply(403,'ORIGIN_OR_CSRF_REJECTED');
 if(!(await strictIntent(request).catch(()=>false)))
  return reply(400,'INVALID_REVIEW_ONLY_INTENT');
 if(typeof loadReviewedPlan!=='function'||typeof env?.LOOP_DB?.prepare!=='function')
  return reply(503,'REVIEW_PLAN_OR_D1_UNAVAILABLE');
 let plan;
 try{plan=await loadReviewedPlan({atMs:now,ownerId:session.id});}
 catch{return reply(503,'REVIEW_PLAN_UNVERIFIED');}
 // The trusted callback can complete after request entry. Use a second
 // clock for attestation freshness and refuse long, reversed or expired
 // reviews, or a concurrent switch away from safe-OFF.
 let postReview;try{postReview=clock();}catch{return reply(503,'CLOCK_UNVERIFIED');}
 if(!Number.isSafeInteger(postReview)||postReview<now||
    postReview-now>30*1000||!exactPlan(plan,postReview)||
    postReview>=plan.expiresAtMs)
   return reply(503,'REVIEW_PLAN_UNVERIFIED_OR_EXPIRED');
 if(env?.SMOKE_OWNER_PREPARE_ENABLED!=='true'||!exactSafeOffEnv(env))
   return reply(503,'PREPARE_DISABLED_AFTER_REVIEW');
 let runId,taskReceiptId;
 try{
  runId='smoke_'+idFactory();
  taskReceiptId='receipt_'+idFactory();
 }catch{return reply(503,'ID_GENERATION_FAILED');}
 if(!ID.test(runId)||!ID.test(taskReceiptId)||runId===taskReceiptId)
  return reply(503,'ID_GENERATION_FAILED');
 const pending=makeSixCallCandidate({
  runId,taskReceiptId,baselineVersion:plan.baselineVersion,
  smokeVersion:plan.smokeVersion,nowMs:postReview,expiresAtMs:plan.expiresAtMs
 });
 if(pending.phase!=='PENDING_EXTERNAL_ACTIVATION')
  return reply(503,'INVALID_REVIEW_SCOPE');
 const db=env.LOOP_DB;
 // The separate UNIQUE PENDING/ACTIVE/RESTORE_REQUIRED SQLite index is the
 // durable source of exclusivity. Do not perform read-then-insert for locking.
 try{
  const created=await db.prepare(INSERT_PENDING).bind(
    runId,session.id,taskReceiptId,pending.target.accountId,
    pending.target.worker,pending.target.databaseId,
    pending.baselineVersion,pending.smokeVersion,postReview,postReview,pending.expiresAtMs
  ).first();
  if(created?.run_id!==runId)return reply(503,'PENDING_WRITE_UNVERIFIED');
  return reply(202,'PENDING_REVIEW_ONLY',{runId,attemptLimit:6,
    note:'No production rollout, no AI execution, no launch consent'});
 }catch{
  try{
   const occupied=await db.prepare(CHECK_EXISTING).bind().first();
   if(occupied)return reply(409,'REVIEW_REQUEST_ALREADY_EXISTS');
  }catch{}
  return reply(503,'PENDING_WRITE_UNAVAILABLE');
 }
}
