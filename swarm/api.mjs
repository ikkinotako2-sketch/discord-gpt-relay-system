// OFFLINE-STAGED owner-only API for the six-role swarm.
// NOT imported by the live Discord Worker. Requires a separate production approval.
import {authenticateDashboard,COMMAND_CENTER_ORIGIN,dashboardConfigured} from '../command-center/server.mjs';
import {createTask,ownerSnapshot,requestStop,resumeAfterQuota} from './engine.mjs';

const BASE='/command-center/api/swarm/';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
function sameOriginWrite(request,session){
  return request.headers.get('Origin')===COMMAND_CENTER_ORIGIN &&
    request.headers.get('Content-Type')?.split(';')[0]?.trim()==='application/json' &&
    typeof session.csrf==='string' &&
    request.headers.get('X-CSRF-Token')===session.csrf;
}
async function inputJson(request){
  const advertised=Number(request.headers.get('content-length'));
  if(Number.isFinite(advertised)&&advertised>4096)throw Error('BODY_TOO_LARGE');
  const raw=await request.text();
  if(raw.length>4096)throw Error('BODY_TOO_LARGE');
  const data=JSON.parse(raw);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_JSON');
  return data;
}
export async function handleSwarmApi(request,env,{runIdFactory=()=>crypto.randomUUID().replaceAll('-','')}={}){
  const url=new URL(request.url);
  if(url.origin!==COMMAND_CENTER_ORIGIN||!url.pathname.startsWith(BASE))return json({error:'NOT_FOUND'},404);
  // Separate, explicit feature flag. This module alone cannot activate a route.
  if(env?.SWARM_API_ENABLED!=='true'||!dashboardConfigured(env))return json({error:'DISABLED'},503);
  const session=await authenticateDashboard(request,env);
  if(!session)return json({error:'AUTH_REQUIRED'},401);
  if(!env.LOOP_DB?.prepare)return json({error:'DB_UNAVAILABLE'},503);
  if(url.pathname===BASE+'overview'&&request.method==='GET'){
    try {
      const snapshot=await ownerSnapshot(env.LOOP_DB,session.id);
      return json({...snapshot,csrfToken:session.csrf,stateSource:'discord_only_d1',live:true,modelLinked:false,runnerEnabled:env?.SWARM_RUNNER_ENABLED==='true'});
    }catch{return json({error:'READ_UNAVAILABLE'},503);}
  }
  if(request.method!=='POST'||!['create','stop','resume'].includes(url.pathname.slice(BASE.length)))
    return json({error:'NOT_FOUND'},404);
  if(!sameOriginWrite(request,session))return json({error:'CSRF_OR_ORIGIN'},403);
  if(env?.SWARM_RUNNER_ENABLED!=='true')return json({error:'RUNNER_NOT_ENABLED'},503);
  let body;
  try{body=await inputJson(request);}catch{return json({error:'INVALID_BODY'},400);}
  try{
    if(url.pathname===BASE+'create'){
      if(typeof body.task!=='string'||!body.task.trim()||body.task.length>1000||
        !Number.isInteger(body.cycles)||body.cycles<1||body.cycles>3)
        return json({error:'INVALID_TASK'},400);
      const runId=runIdFactory();
      const result=await createTask(env.LOOP_DB,{runId,ownerId:session.id,
        task:body.task,cycles:body.cycles});
      return json(result,result.status==='created'?201:result.status==='busy'?409:200);
    }
    if(url.pathname===BASE+'stop'){
      return json(await requestStop(env.LOOP_DB,session.id));
    }
    if(url.pathname===BASE+'resume'){
      if(typeof body.runId!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/).test(body.runId))
        return json({error:'INVALID_ID'},400);
      // This only requeues; the independent runner still requires a valid budget preflight.
      return json(await resumeAfterQuota(env.LOOP_DB,body.runId,session.id));
    }
  }catch{return json({error:'OPERATION_UNAVAILABLE'},503);}
  return json({error:'NOT_FOUND'},404);
}
