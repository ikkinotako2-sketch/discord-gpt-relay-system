// OFFLINE STAGED: owner-only, CSRF-protected emergency STOP request.
// NO deployed import, AI call, Worker deployment, or baseline restore POST.
// Unlike creating a job, owner STOP must not require RUNNER_ENABLED.
// It durably prohibits NEW six-call claims; in-flight provider calls might still
// run and MUST be treated as uncertain pending independent restoration.
import {authenticateDashboard,dashboardConfigured,COMMAND_CENTER_ORIGIN}
 from '../command-center/server.mjs';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';

export const SMOKE_OWNER_STOP_PATH='/command-center/api/swarm/smoke/stop';
const RUN_ID=/^[A-Za-z0-9_-]{8,100}$/;
const send=(status,code,extra={})=>new Response(JSON.stringify({
 status:code,authorizesInference:false,authorizesDeployment:false,
 remoteBaselineRestored:false,...extra
}),{status,headers:{'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
function same(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length>200||b.length>200)return false;
 let mask=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)
  mask|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return mask===0;
}
async function parse(request){
 const length=request.headers.get('Content-Length');
 if(length!==null&&(!/^\d{1,3}$/.test(length)||Number(length)>256))
  return null;
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>256)return null;
 let body;try{body=JSON.parse(raw);}catch{return null;}
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).length!==2||
    body.intent!=='STOP_SIX_CALL_NO_NEW_ATTEMPTS'||
    !RUN_ID.test(body.runId||''))return null;
 return body;
}
/** This function is only a draft adapter: no existing live route calls it.
 * The run store validates the verified session ID against the actual D1 owner;
 * a browser cannot provide ownerId, provider result, or rollback status.
 */
export async function handleSmokeOwnerStop(request,env,{
 clock=Date.now,
 createStore=createD1SixCallStore
}={}){
 let url;try{url=new URL(request?.url);}catch{return send(404,'NOT_FOUND');}
 if(url.origin!==COMMAND_CENTER_ORIGIN||url.pathname!==SMOKE_OWNER_STOP_PATH||
    url.search||url.hash)return send(404,'NOT_FOUND');
 if(request.method!=='POST')return send(405,'METHOD_NOT_ALLOWED');
 if(env?.SMOKE_OWNER_STOP_ENABLED!=='true'||!dashboardConfigured(env))
  return send(503,'STOP_DISABLED');
 let now;try{now=clock();}catch{return send(503,'CLOCK_UNVERIFIED');}
 if(!Number.isSafeInteger(now)||now<1e12)return send(503,'CLOCK_UNVERIFIED');
 let session;try{session=await authenticateDashboard(request,env,now);}
 catch{return send(401,'AUTH_REQUIRED');}
 if(!session||session.id!==String(env.DISCORD_ALLOWED_USER_ID))
  return send(401,'AUTH_REQUIRED');
 if(request.headers.get('Origin')!==COMMAND_CENTER_ORIGIN||
    request.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/json'||
    !same(request.headers.get('X-CSRF-Token'),session.csrf)||
    !['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))
  return send(403,'ORIGIN_OR_CSRF_REJECTED');
 const body=await parse(request).catch(()=>null);
 if(!body)return send(400,'INVALID_STOP_REQUEST');
 try{
  const store=createStore({db:env.LOOP_DB,runId:body.runId});
  const result=await store.requestStopOnce({
   runId:body.runId,ownerId:session.id,nowMs:now
  });
  if(result?.status!=='STOP_RECORDED')
   return send(409,'STOP_NOT_APPLIED_OR_NOT_OWNED');
  // STOP is NOT a Cloudflare baseline restore; do not call it 'safe OFF'.
  return send(202,'STOP_DURABLY_RECORDED',{
   runId:body.runId,phase:result.phase,
   pendingInFlight:result.pendingInFlight===true,
   independentRollbackVerificationRequired:true
  });
 }catch{return send(503,'STOP_PERSISTENCE_UNVERIFIED');}
}
