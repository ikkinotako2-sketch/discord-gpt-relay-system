// Command Center private dashboard backend. NOT deployed or imported by live Worker.
// Enable only after Discord OAuth2 redirect and two fresh secrets are provisioned.
// Owner-only; no public D1 APIs, tokens in query strings or user text in logs.
import {DASHBOARD_HTML} from './page.mjs';
import {getOwnerDashboardSnapshot} from './data.mjs';
import {createDurableLoop,requestDurableStop} from '../loop-d1.mjs';
import {resolveLoopModel,GPT_OSS_MODEL} from '../loop-quality.mjs';

export const COMMAND_CENTER_ORIGIN='https://steep-glitter-b5cddiscord-ai-relay-lab.ikkinotako2.workers.dev';
const BASE='/command-center';
const CALLBACK=COMMAND_CENTER_ORIGIN+BASE+'/callback';
const CLIENT_ID='1558705011339427840';
const COOKIE='dc_session';
const STATE_COOKIE='dc_oauth_state';
const MAX_SESSION_MS=60*60*1000;
const authReady=env=>env?.DASHBOARD_ENABLED==='true'&&
  typeof env?.DISCORD_OAUTH_CLIENT_SECRET==='string'&&env.DISCORD_OAUTH_CLIENT_SECRET.length>15&&
  typeof env?.DASHBOARD_COOKIE_KEY==='string'&&env.DASHBOARD_COOKIE_KEY.length>=32&&
  /^\d{15,22}$/.test(String(env?.DISCORD_ALLOWED_USER_ID||''))&&!!env?.LOOP_DB?.prepare;
const headers=()=>({
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
});
function plain(text,status=200){
  return new Response(text,{status,headers:{...headers(),'Content-Type':'text/plain; charset=utf-8'}});
}
function json(value,status=200){
  return new Response(JSON.stringify(value),{
    status,headers:{...headers(),'Content-Type':'application/json; charset=utf-8'}});
}
function redirect(url){
  return new Response(null,{status:302,headers:{...headers(),Location:url}});
}
function cookie(request,name){
  const raw=request.headers.get('Cookie')||'';
  const part=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  if(!part)return null;
  const value=part.slice(name.length+1);
  return value.length<4096?value:null;
}
function secureCookie(name,value,age){
  return name+'='+value+'; Path='+BASE+'; Max-Age='+age+
    '; Secure; HttpOnly; SameSite=Lax';
}
function encoded(bytes){
  let ascii='';for(const n of new Uint8Array(bytes))ascii+=String.fromCharCode(n);
  return btoa(ascii).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decoded(input){
  if(!/^[A-Za-z0-9_-]{2,2048}$/.test(input))throw Error('Invalid encoding');
  const raw=atob(input.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function mac(payload,key){
  const cryptoKey=await crypto.subtle.importKey('raw',
    new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encoded(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(payload)));
}
function constantTimeEquals(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  let diff=a.length^b.length;
  const count=Math.max(a.length,b.length);
  for(let i=0;i<count;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
export async function createDashboardSession(userId,env,now=Date.now()){
  if(!authReady(env)||String(userId)!==String(env.DISCORD_ALLOWED_USER_ID))
    throw Error('Unauthorized dashboard session');
  const payload=encoded(new TextEncoder().encode(JSON.stringify({
    id:String(userId),exp:now+MAX_SESSION_MS,csrf:crypto.randomUUID()
  })));
  return payload+'.'+await mac(payload,env.DASHBOARD_COOKIE_KEY);
}
export async function authenticateDashboard(request,env,now=Date.now()){
  if(!authReady(env))return null;
  const raw=cookie(request,COOKIE);
  if(!raw||raw.length>2048||raw.split('.').length!==2)return null;
  const [payload,signature]=raw.split('.');
  if(!constantTimeEquals(signature,await mac(payload,env.DASHBOARD_COOKIE_KEY)))return null;
  let data;
  try {data=JSON.parse(new TextDecoder().decode(decoded(payload)));}catch{return null;}
  if(data?.id!==String(env.DISCORD_ALLOWED_USER_ID)||!Number.isFinite(data.exp)||
    now>=data.exp||data.exp>now+MAX_SESSION_MS||typeof data.csrf!=='string')return null;
  return data;
}
async function dashboardHtml(){
  const style=DASHBOARD_HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
  const script=DASHBOARD_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
  const digest=async content=>'sha256-'+btoa(String.fromCharCode(
    ...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))));
  const [styleHash,scriptHash]=await Promise.all([digest(style),digest(script)]);
  const csp="default-src 'none'; script-src '"+scriptHash+"'; style-src '"+
    styleHash+"'; style-src-attr 'unsafe-inline'; connect-src 'self'; "+
    "img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return new Response(DASHBOARD_HTML,{
    status:200,
    headers:{...headers(),'Content-Type':'text/html; charset=utf-8',
      'Content-Security-Policy':csp}
  });
}
function validMutatingRequest(request,session){
  if(request.headers.get('Origin')!==COMMAND_CENTER_ORIGIN)return false;
  if(request.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/json')return false;
  return constantTimeEquals(request.headers.get('X-CSRF-Token'),session.csrf);
}
async function handleCallback(request,env,url){
  const state=url.searchParams.get('state');
  const code=url.searchParams.get('code');
  if(!state||!/^[-a-f0-9]{36}$/i.test(state)||!constantTimeEquals(state,cookie(request,STATE_COOKIE))||
    !code||code.length>1500)return plain('Invalid OAuth callback',400);
  let tokenReply,identityReply;
  try{
    const body=new URLSearchParams({
      client_id:CLIENT_ID,client_secret:env.DISCORD_OAUTH_CLIENT_SECRET,
      grant_type:'authorization_code',code,redirect_uri:CALLBACK
    });
    tokenReply=await fetch('https://discord.com/api/v10/oauth2/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body,signal:AbortSignal.timeout(12000)
    });
    if(!tokenReply.ok)return plain('Discord OAuth exchange failed',502);
    const token=await tokenReply.json();
    if(typeof token.access_token!=='string'||token.token_type!=='Bearer')return plain('Invalid OAuth exchange',502);
    identityReply=await fetch('https://discord.com/api/v10/users/@me',{
      headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)
    });
    if(!identityReply.ok)return plain('Discord identity verification failed',502);
    const user=await identityReply.json();
    if(String(user.id)!==String(env.DISCORD_ALLOWED_USER_ID))return plain('Not authorized for this dashboard',403);
    const session=await createDashboardSession(user.id,env);
    const response=redirect(BASE+'/');
    response.headers.append('Set-Cookie',secureCookie(STATE_COOKIE,'',0));
    response.headers.append('Set-Cookie',secureCookie(COOKIE,session,3600));
    return response;
  }catch{return plain('Discord login unavailable',502);}
}
export async function handleDashboardRequest(request,env){
  const url=new URL(request.url);
  if(url.origin!==COMMAND_CENTER_ORIGIN||!url.pathname.startsWith(BASE))
    return plain('Unknown dashboard origin or path',404);
  if(!authReady(env))return plain('Private dashboard not configured',503);
  if(url.pathname===BASE+'/login'&&request.method==='GET'){
    const state=crypto.randomUUID();
    const authorize=new URL('https://discord.com/oauth2/authorize');
    authorize.searchParams.set('client_id',CLIENT_ID);
    authorize.searchParams.set('redirect_uri',CALLBACK);
    authorize.searchParams.set('response_type','code');
    authorize.searchParams.set('scope','identify');
    authorize.searchParams.set('state',state);
    authorize.searchParams.set('prompt','consent');
    const r=redirect(authorize.toString());
    r.headers.append('Set-Cookie',secureCookie(STATE_COOKIE,state,600));
    return r;
  }
  if(url.pathname===BASE+'/callback'&&request.method==='GET')return handleCallback(request,env,url);
  const session=await authenticateDashboard(request,env);
  if(!session)return url.pathname===BASE||url.pathname===BASE+'/'?
    redirect(BASE+'/login'):json({error:'AUTH_REQUIRED'},401);
  if((url.pathname===BASE||url.pathname===BASE+'/')&&request.method==='GET')
    return dashboardHtml();
  if(url.pathname===BASE+'/api/overview'&&request.method==='GET'){
    const snapshot=await getOwnerDashboardSnapshot(env.LOOP_DB,session.id);
    const model=resolveLoopModel(env);
    // This labels CURRENT configured model only; older D1 jobs have no model ID.
    return json({...snapshot,modelName:model===GPT_OSS_MODEL?'GPT-OSS 20B':'Llama 3.1 8B',
      modelScope:'current_settings_only',csrfToken:session.csrf});
  }
  if(url.pathname===BASE+'/api/start'&&request.method==='POST'){
    if(!validMutatingRequest(request,session))return json({error:'CSRF_REJECTED'},403);
    const raw=await request.text();
    if(raw.length>2200)return json({error:'TASK_TOO_LONG'},400);
    let input;try{input=JSON.parse(raw)}catch{return json({error:'INVALID_JSON'},400)}
    if(typeof input.task!=='string'||!input.task.trim()||input.task.length>1000)
      return json({error:'INVALID_TASK'},400);
    const runId='w'+crypto.randomUUID().replace(/-/g,'');
    const result=await createDurableLoop(env.LOOP_DB,{runId,requesterId:session.id,task:input.task});
    if(result.busy)return json({error:'ALREADY_RUNNING'},409);
    return json({accepted:result.created,runId},result.created?202:409);
  }
  if(url.pathname===BASE+'/api/stop'&&request.method==='POST'){
    if(!validMutatingRequest(request,session))return json({error:'CSRF_REJECTED'},403);
    return json(await requestDurableStop(env.LOOP_DB,session.id));
  }
  if(url.pathname===BASE+'/logout'&&request.method==='POST'){
    if(!validMutatingRequest(request,session))return json({error:'CSRF_REJECTED'},403);
    const r=json({loggedOut:true});
    r.headers.append('Set-Cookie',secureCookie(COOKIE,'',0));return r;
  }
  return plain('Not found',404);
}
