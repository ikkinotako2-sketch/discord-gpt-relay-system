// One-off Discord-only live six-role smoke controller.
// Runs only inside explicitly approved, scoped GitHub Actions. Never touches PLM.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDiscordD1ReadClient,DISCORD_D1_URL} from '../swarm/smoke-watchdog-d1.mjs';

const exec=promisify(execFile),sleep=t=>new Promise(r=>setTimeout(r,t));
const ACCOUNT='6c8ccd6aface937ab5dabef61cb64534';
const PRIMARY='steep-glitter-b5cddiscord-ai-relay-lab';
const WATCH='discord-smoke-independent-watchdog-staged';
const BASELINE='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const D1ID='d80b08a4-0ff7-4320-9575-0d3c55cf7aba';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/';
const HOME='https://'+PRIMARY+'.ikkinotako2.workers.dev';
const FLAGS=['SWARM_API_ENABLED','SWARM_RUNNER_ENABLED','SWARM_EXECUTION_APPROVED','SWARM_EXCLUSIVE_MODE'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const narrow=process.env.WATCHDOG_RESTORE_TOKEN,broad=process.env.CLOUDFLARE_API_TOKEN,d1token=process.env.DISCORD_D1_READ_TOKEN;
const candidateConfig='wrangler.discord-six-call-one-shot.toml';
const parkedConfig='swarm/wrangler.watchdog.example.toml';
const armedConfig='swarm/wrangler.watchdog-six-call-one-shot.toml';
const safeOffConfig='wrangler.discord-flags-off-one-shot.toml';
const reader=createDiscordD1ReadClient({token:d1token});
const TEST_START=Date.now();
let tail=null,tailOutput='',expiry=0,candidate=null,armed=false,liveDeployed=false;
let success=false,jobSeen=false,restoredByAlarm=false,postedFallback=false,shadowNeedsOff=false;
let status='STARTING';
function requireTrue(cond,code){if(!cond)throw Error(code);}
const bindings=(bs,k)=>bs.filter(b=>b?.name===k);
const val=(bs,k)=>bindings(bs,k).length===1&&bindings(bs,k)[0].type==='plain_text'?bindings(bs,k)[0].text:null;
const auth=t=>({Authorization:'Bearer '+t});
async function get(w,suffix,token){
  const r=await fetch(ROOT+w+suffix,{method:'GET',headers:auth(token),signal:AbortSignal.timeout(15000)});
  requireTrue(r.status===200,'CLOUDFLARE_GET_HTTP_'+r.status+'_'+suffix);
  const j=await r.json();requireTrue(j.success===true&&j.result!==undefined,'CLOUDFLARE_GET_UNVERIFIED_'+suffix);
  return j.result;
}
async function live(){
  const d=await get(PRIMARY,'/deployments',narrow),a=d?.deployments?.[0];
  requireTrue(a?.versions?.length===1&&a.versions[0].percentage===100&&UUID.test(a.id||''),'SPLIT_OR_BAD_DEPLOYMENT');
  return {version:a.versions[0].version_id,id:a.id};
}
async function d1Query(sql){
  const r=await fetch(DISCORD_D1_URL,{method:'POST',headers:{...auth(d1token),'Content-Type':'application/json'},
    body:JSON.stringify({sql}),signal:AbortSignal.timeout(15000)});
  const x=await r.json();requireTrue(r.ok&&x?.success===true&&x.result?.[0]?.success===true&&Array.isArray(x.result[0].results),
    'DISCORD_READONLY_QUERY_FAILED');
  return x.result[0].results;
}
async function publicStatus(expectSwarm){
  const [root,signature,portal,overview]=await Promise.all([
    fetch(HOME+'/',{signal:AbortSignal.timeout(15000)}),
    fetch(HOME+'/',{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)}),
    fetch(HOME+'/command-center/swarm',{redirect:'manual',signal:AbortSignal.timeout(15000)}),
    fetch(HOME+'/command-center/api/swarm/overview',{signal:AbortSignal.timeout(15000)})
  ]);
  requireTrue(root.status===200&&signature.status===401,
    'PRIMARY_HEALTH_OR_DISCORD_SIGNATURE_FAILURE');
  requireTrue((await root.text()).trim()==='Discord GPT Relay gpt-oss command-center ready.',
    'PRIMARY_HEALTH_MARKER_CHANGED');
  if(expectSwarm){
    // Anonymous request may redirect to owner login, not expose the task or CSRF token.
    requireTrue([302,303,307,308,401].includes(portal.status)&&overview.status===401,
      'LIVE_OWNER_DASHBOARD_NOT_AUTH_GATED');
  }else requireTrue(portal.status===503&&overview.status===503,'PRIMARY_SWARM_OFF_FAILED');
}
async function parked(){
  const [p,dep,secrets,sched,d1]=await Promise.all([
    get(WATCH,'/settings',broad),live(),get(WATCH,'/secrets',broad),
    get(WATCH,'/schedules',broad),reader.snapshot()
  ]);
  requireTrue(!Array.isArray(p?.bindings)?false:true,'WATCHDOG_BINDINGS_MISSING');
  for(const [k,v] of [['WATCHDOG_ARMED','false'],['WATCHDOG_APPROVAL','NOT_APPROVED'],
    ['WATCHDOG_BASELINE_VERSION','UNSET'],['WATCHDOG_SMOKE_VERSION','UNSET'],
    ['WATCHDOG_EXPECTED_DEPLOYMENT_ID','UNSET'],['WATCHDOG_EXPIRES_AT','UNSET']])
    requireTrue(val(p.bindings,k)===v,'WATCHDOG_NOT_PARKED_'+k);
  requireTrue(Array.isArray(secrets)&&['WATCHDOG_RESTORE_TOKEN','WATCHDOG_D1_READ_TOKEN'].every(k=>
    secrets.filter(s=>s?.name===k).length===1),'WATCHDOG_SECRETS_UNVERIFIED');
  requireTrue(sched?.schedules?.length===1&&sched.schedules[0].cron==='* * * * *','WATCHDOG_CRON_WRONG');
  requireTrue(dep.version===BASELINE&&d1.clean,'BASELINE_OR_D1_NOT_CLEAN');
}
async function primarySafe(){
  const [dep,s,b,d1]=await Promise.all([live(),get(PRIMARY,'/settings',narrow),
    get(PRIMARY,'/versions/'+BASELINE,narrow),reader.snapshot()]);
  requireTrue(dep.version===BASELINE&&d1.clean,'PRIMARY_NOT_CLEAN');
  for(const bs of [s.bindings,b.resources?.bindings]){
    requireTrue(Array.isArray(bs),'PRIMARY_BINDINGS_INVALID');
    for(const k of FLAGS){
      const entries=bindings(bs,k);
      requireTrue(entries.length<=1&&entries.every(x=>x.type==='plain_text'&&x.text==='false'),
        'PRIMARY_FLAG_NOT_OFF_'+k);
    }
    for(const k of ['DISCORD_PUBLIC_KEY','DISCORD_ALLOWED_USER_ID','DISCORD_OAUTH_CLIENT_SECRET','DASHBOARD_COOKIE_KEY'])
      requireTrue(bindings(bs,k).length===1&&bindings(bs,k)[0].type==='secret_text','MISSING_OWNER_SECRET_'+k);
    const db=bindings(bs,'LOOP_DB');
    requireTrue(db.length===1&&db[0].type==='d1'&&db[0].database_id===D1ID,'D1_BOUND_TO_WRONG_DB');
  }
  await publicStatus(false);
}
async function cmd(config,args,token,timeout=120000,allowFailure=false){
  try{
    const r=await exec('npx',['--yes','wrangler@4.119.0',...args,'--config',config],{
      timeout,maxBuffer:5*1024*1024,env:{...process.env,CLOUDFLARE_API_TOKEN:token}
    });
    return {ok:true,log:(r.stdout||'').slice(-9000)};
  }catch(e){
    if(!allowFailure)throw Error('WRANGLER_OPERATION_FAILED_'+args.join('_'));
    return {ok:false,log:((e.stdout||'')+'\n'+(e.stderr||'')).slice(-7000)};
  }
}
function replaceOnce(s,a,b){
  requireTrue(s.split(a).length===2,'UNEXPECTED_REFERENCE_CONFIG');
  return s.replace(a,b);
}
function makeCandidate(){
  let c=fs.readFileSync('wrangler.command-center.toml','utf8');
  for(const phrase of ['name = "'+PRIMARY+'"','main = "worker-loop.mjs"','keep_vars = true',
    'database_id = "'+D1ID+'"','[vars]','crons = ["*/1 * * * *"]'])
    requireTrue(c.includes(phrase),'PRIMARY_WRANGLER_CHANGED');
  const additions=[...FLAGS.map(k=>k+' = "true"'),
    'SWARM_DAILY_CALL_CAP = "6"','SWARM_SMOKE_EXPIRES_AT = "'+expiry+'"'].join('\n');
  requireTrue(!FLAGS.concat(['SWARM_DAILY_CALL_CAP','SWARM_SMOKE_EXPIRES_AT']).some(k=>c.includes(k+' =')),
    'PRIMARY_CONFIG_DUPLICATES');
  c=replaceOnce(c,'[vars]\n','[vars]\n'+additions+'\n');
  fs.writeFileSync(candidateConfig,c,{flag:'wx',mode:0o600});
  let off=fs.readFileSync('wrangler.command-center.toml','utf8');
  off=replaceOnce(off,'[vars]\n','[vars]\n'+FLAGS.map(k=>k+' = "false"').join('\n')+'\n');
  fs.writeFileSync(safeOffConfig,off,{flag:'wx',mode:0o600});
}
function makeArmed(){
  let t=fs.readFileSync(parkedConfig,'utf8');
  for(const [a,b] of [
    ['WATCHDOG_ARMED = "false"','WATCHDOG_ARMED = "EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE"'],
    ['WATCHDOG_APPROVAL = "NOT_APPROVED"','WATCHDOG_APPROVAL = "RESTORE-DISCORD-SMOKE-BASELINE-ONCE"'],
    ['WATCHDOG_BASELINE_VERSION = "UNSET"','WATCHDOG_BASELINE_VERSION = "'+BASELINE+'"'],
    ['WATCHDOG_SMOKE_VERSION = "UNSET"','WATCHDOG_SMOKE_VERSION = "'+candidate+'"'],
    ['WATCHDOG_EXPECTED_DEPLOYMENT_ID = "UNSET"','WATCHDOG_EXPECTED_DEPLOYMENT_ID = "PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT"'],
    ['WATCHDOG_EXPIRES_AT = "UNSET"','WATCHDOG_EXPIRES_AT = "'+expiry+'"']
  ])t=replaceOnce(t,a,b);
  requireTrue(t.includes('workers_dev = false')&&t.includes('crons = ["* * * * *"]'),
    'WATCHDOG_REFERENCE_CHANGED');
  fs.writeFileSync(armedConfig,t,{flag:'wx',mode:0o600});
}
async function findCandidate(){
  const versions=await get(PRIMARY,'/versions',narrow);
  const items=versions?.items??versions?.versions;
  requireTrue(Array.isArray(items)&&items.length<=100,'VERSION_CATALOG_INCOMPLETE');
  const matches=[];
  for(const i of items.slice(0,25)){
    if(!UUID.test(i.id||''))continue;
    const ver=await get(PRIMARY,'/versions/'+i.id,narrow);
    const bs=ver.resources?.bindings;
    if(!Array.isArray(bs))continue;
    if(FLAGS.every(k=>val(bs,k)==='true')&&
       val(bs,'SWARM_DAILY_CALL_CAP')==='6'&&
       val(bs,'SWARM_SMOKE_EXPIRES_AT')===String(expiry)){
      const db=bindings(bs,'LOOP_DB');
      requireTrue(db.length===1&&db[0].type==='d1'&&db[0].database_id===D1ID,'CANDIDATE_WRONG_D1');
      for(const k of ['DISCORD_PUBLIC_KEY','DISCORD_ALLOWED_USER_ID','DISCORD_OAUTH_CLIENT_SECRET','DASHBOARD_COOKIE_KEY'])
        requireTrue(bindings(bs,k).length===1&&bindings(bs,k)[0].type==='secret_text','CANDIDATE_LOST_SECRET');
      matches.push(i.id);
    }
  }
  requireTrue(matches.length===1,'CANDIDATE_NOT_UNIQUE_OR_MISSING');
  return matches[0];
}
function parseTail(){
  const events=[];let depth=0,start=-1,str=false,esc=false;
  for(let i=0;i<tailOutput.length;i++){
    const c=tailOutput[i];
    if(depth===0){if(c==='{'){start=i;depth=1;str=false;esc=false;}continue;}
    if(esc){esc=false;continue;}
    if(c==='\\'&&str){esc=true;continue;}
    if(c==='"'){str=!str;continue;}
    if(str)continue;
    if(c==='{')depth++;
    if(c==='}'){depth--;if(depth===0&&start>=0){try{events.push(JSON.parse(tailOutput.slice(start,i+1)));}catch{}start=-1;}}
  }
  const entries=[];
  for(const ev of events){
    for(const line of ev.logs??[]){
      for(const message of (Array.isArray(line.message)?line.message:[line.message])){
        if(typeof message!=='string')continue;
        try{const obj=JSON.parse(message);if(['discord_smoke_watchdog','discord_smoke_alarm'].includes(obj?.component))
          entries.push(obj);}catch{}
      }
    }
  }
  return entries;
}
async function startTail(){
  tail=spawn('npx',['--yes','wrangler@4.119.0','tail','--config',parkedConfig,'--format','json'],{
    env:{...process.env,CLOUDFLARE_API_TOKEN:broad},stdio:['ignore','pipe','pipe']});
  tail.stdout.on('data',b=>{tailOutput+=(b.toString());if(tailOutput.length>450000)tailOutput=tailOutput.slice(-300000);});
  tail.stderr.on('data',()=>{});
  await sleep(7000);
  requireTrue(tail.exitCode===null,'WATCHDOG_TAIL_UNAVAILABLE');
}
async function waitForArm(){
  const stop=Math.min(expiry-4*60*1000,Date.now()+130000);
  while(Date.now()<stop){
    if(parseTail().some(o=>o.component==='discord_smoke_watchdog'&&o.alarm==='ARMED')){
      console.log('REAL_CRON_DURABLE_ALARM_PREARM_CONFIRMED');
      return;
    }
    await sleep(4500);
  }
  throw Error('REAL_CRON_ALARM_PREARM_NOT_CONFIRMED');
}
async function deploySmoke(){
  const before=await live();requireTrue(before.version===BASELINE,'BASELINE_CHANGED_PRE_DEPLOY');
  const d1=await reader.snapshot();requireTrue(d1.clean,'D1_NONZERO_PRE_DEPLOY');
  const version=await get(PRIMARY,'/versions/'+candidate,narrow);
  requireTrue(FLAGS.every(k=>val(version.resources?.bindings??[],k)==='true')&&
    val(version.resources.bindings,'SWARM_SMOKE_EXPIRES_AT')===String(expiry),
    'CANDIDATE_FLAGS_WRONG');
  requireTrue(Date.now()<expiry-3*60*1000,'EXPIRY_TOO_CLOSE_TO_ACTIVATE');
  // EXACTLY ONE POST: never retry if response is lost or ambiguous.
  let response;
  try{response=await fetch(ROOT+PRIMARY+'/deployments',{
    method:'POST',headers:{...auth(narrow),'Content-Type':'application/json'},
    body:JSON.stringify({strategy:'percentage',versions:[{percentage:100,version_id:candidate}],
      annotations:{'workers/message':'Owner-approved Discord six-role MAX6 expiry-bounded smoke one time'}}),
    signal:AbortSignal.timeout(16000)
  });}catch{throw Error('DEPLOYMENT_POST_OUTCOME_UNCERTAIN_DO_NOT_RETRY');}
  const json=await response.json().catch(()=>null);
  requireTrue(response.ok&&json?.success===true&&UUID.test(json?.result?.id||''),
    'CANDIDATE_DEPLOYMENT_RESPONSE_UNVERIFIED_DO_NOT_RETRY');
  liveDeployed=true;
  let after;
  for(let i=0;i<7;i++){after=await live();if(after.version===candidate&&after.id===json.result.id)break;await sleep(1200);}
  requireTrue(after?.version===candidate&&after.id===json.result.id,'SMOKE_DEPLOYMENT_RECEIPT_MISMATCH');
  await publicStatus(true);
  console.log('OWNER_SIX_ROLE_DASHBOARD_READY=https://'+PRIMARY+'.ikkinotako2.workers.dev/command-center/swarm');
  console.log('OWNER_MUST_USE_DISCORD_OAUTH_SESSION_AND_CLICK_CREATE_ONE_CYCLE');
  console.log('SIX_CALL_SMOKE_DEPLOYED_WITH_REAL_PREARMED_DO_ALARM_EXPIRES='+new Date(expiry).toISOString());
}
async function jobState(){
  const rows=await d1Query('SELECT status,calls_used,cycles,created_at FROM swarm_jobs WHERE created_at>='+TEST_START+' ORDER BY created_at DESC LIMIT 3');
  requireTrue(rows.length<=1,'MORE_THAN_ONE_JOB_CREATED_DURING_SMOKE');
  return rows;
}
async function observe(){
  let last='';
  while(Date.now()<=expiry+110000){
    const l=await live();
    const events=parseTail();
    if(l.version===BASELINE){
      restoredByAlarm=events.some(e=>e.component==='discord_smoke_alarm'&&e.status==='OFF_VERIFIED')||
        events.some(e=>e.component==='discord_smoke_watchdog'&&e.status==='OFF_VERIFIED');
      console.log('WATCHDOG_BASELINE_RESTORED_BEFORE_MANUAL_CLEANUP='+restoredByAlarm);
      break;
    }
    requireTrue(l.version===candidate,'UNEXPECTED_EXTERNAL_DEPLOYMENT');
    const rows=await jobState();
    const recent=rows.filter(r=>Number.isInteger(r.calls_used));
    if(recent.length>0){jobSeen=true;const state=recent[0].status+':'+recent[0].calls_used+'/6';
      if(last!==state){console.log('DISCORD_SIX_ROLE_JOB_STATE='+state);last=state;}}
    if(recent.some(r=>r.status==='completed'&&r.calls_used===6&&r.cycles===1))
      success=true;
    if(Date.now()<expiry)await sleep(8500);else await sleep(5000);
  }
  if((await live()).version!==BASELINE)
    throw Error('WATCHDOG_DID_NOT_RESTORE_BASELINE_NEEDS_GUARDED_FALLBACK');
}
async function fallbackRestore(){
  const l=await live();
  if(l.version===BASELINE)return;
  requireTrue(l.version===candidate,'UNKNOWN_LIVE_VERSION_NO_FALLBACK');
  if(postedFallback)throw Error('FALLBACK_ALREADY_ATTEMPTED');
  postedFallback=true;
  const p=await fetch(ROOT+PRIMARY+'/deployments',{
    method:'POST',headers:{...auth(narrow),'Content-Type':'application/json'},
    body:JSON.stringify({strategy:'percentage',versions:[{percentage:100,version_id:BASELINE}],
      annotations:{'workers/message':'Discord emergency owner-approved one-shot baseline cleanup'}}),
    signal:AbortSignal.timeout(16000)
  });
  const j=await p.json().catch(()=>null);
  requireTrue(p.ok&&j?.success===true&&UUID.test(j?.result?.id||''),'FALLBACK_POST_UNCERTAIN_DO_NOT_RETRY');
  for(let i=0;i<8;i++){if((await live()).version===BASELINE)return;await sleep(1100);}
  throw Error('FALLBACK_BASELINE_NOT_VERIFIED');
}
async function cleanup(){
  let failed=false;
  try{await fallbackRestore();console.log('PRIMARY_BASELINE_RETURNED_100_PERCENT');}
  catch(e){failed=true;console.log('EMERGENCY_BASELINE_RESTORE_FAILED_'+e.message);}
  // Only after baseline version has been observed, park the backup.
  if(!failed){
    try{if(armed||fs.existsSync(armedConfig)){
      await cmd(parkedConfig,['deploy','--keep-vars'],broad,120000);
      armed=false;
      console.log('INDEPENDENT_WATCHDOG_PARKED_DEPLOYED');
    }}catch{failed=true;console.log('WATCHDOG_PARKED_CLEANUP_FAILED');}
  }
  if(fs.existsSync(safeOffConfig)){
    try{
      // Upload resets mutable script-level flags without switching production traffic.
      await cmd(safeOffConfig,['versions','upload','--strict','--keep-vars',
        '--message','Discord six-role smoke cleanup: script shadow flags OFF'],narrow,120000,true);
      const s=await get(PRIMARY,'/settings',narrow);
      requireTrue(FLAGS.every(k=>val(s.bindings,k)==='false'),'SCRIPT_SHADOW_FLAGS_NOT_OFF');
      shadowNeedsOff=false;
      console.log('PRIMARY_SCRIPT_FLAGS_RECONCILED_ALL_FALSE');
    }catch{failed=true;console.log('SCRIPT_FLAG_OFF_RECONCILIATION_NOT_VERIFIED');}
  }
  try{
    const [l,ps,ws,d1]=await Promise.all([live(),get(PRIMARY,'/settings',narrow),
      get(WATCH,'/settings',broad),reader.snapshot()]);
    requireTrue(l.version===BASELINE,'FINAL_BASELINE_NOT_SERVING');
    requireTrue(FLAGS.every(k=>val(ps.bindings,k)==='false'),'FINAL_PRIMARY_FLAGS_NOT_FALSE');
    for(const [k,v] of [['WATCHDOG_ARMED','false'],['WATCHDOG_APPROVAL','NOT_APPROVED'],
      ['WATCHDOG_BASELINE_VERSION','UNSET'],['WATCHDOG_SMOKE_VERSION','UNSET'],
      ['WATCHDOG_EXPECTED_DEPLOYMENT_ID','UNSET'],['WATCHDOG_EXPIRES_AT','UNSET']])
      requireTrue(val(ws.bindings,k)===v,'FINAL_WATCHDOG_NOT_PARKED_'+k);
    await publicStatus(false);
    console.log('FINAL_OFF_STATE_BASELINE_AND_WATCHDOG_VERIFIED');
    console.log('FINAL_D1_CLEAN='+d1.clean);
    if(!d1.clean)failed=true;
  }catch(e){failed=true;console.log('FINAL_STATE_VERIFY_FAILED_'+e.message);}
  if(tail){tail.kill('SIGTERM');tail=null;}
  if(failed)throw Error('EMERGENCY_MANUAL_STATE_REVIEW_REQUIRED');
}
async function main(){
  requireTrue(process.env.GITHUB_REPOSITORY==='ikkinotako2-sketch/discord-gpt-relay-system'&&
    process.env.GITHUB_REF==='refs/heads/experiment/discord-six-role-live-smoke-20261023'&&
    process.env.GITHUB_EVENT_NAME==='push','UNAUTHORIZED_REPO_OR_BRANCH');
  requireTrue(typeof broad==='string'&&typeof narrow==='string'&&typeof d1token==='string',
    'SCOPED_CREDENTIALS_MISSING');
  await Promise.all([primarySafe(),parked()]);
  console.log('PREDEPLOY_PRIMARY_AND_WATCHDOG_READINESS_PASS');
  // The task can be created only by the real Discord owner through authenticated OAuth+CSRF.
  expiry=Date.now()+16*60*1000;
  makeCandidate();
  await cmd(candidateConfig,['deploy','--dry-run','--outdir','/tmp/discord-smoke-compiled'],narrow);
  // Wrangler may exit 1 after a successful version upload while requesting account subdomain.
  await cmd(candidateConfig,['versions','upload','--strict','--keep-vars',
    '--message','Owner-approved six-role max6 nonserving version for <=16min'],narrow,120000,true);
  shadowNeedsOff=true;
  candidate=await findCandidate();
  requireTrue((await live()).version===BASELINE,'TRAFFIC_CHANGED_DURING_UPLOAD');
  console.log('NEW_NON_SERVING_SIX_CALL_VERSION_REMOTE_CONFIRMED='+candidate);
  makeArmed();
  await startTail();
  await cmd(armedConfig,['deploy','--keep-vars'],broad);
  armed=true;
  const w=await get(WATCH,'/settings',broad);
  requireTrue(val(w.bindings,'WATCHDOG_ARMED')==='EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE'&&
    val(w.bindings,'WATCHDOG_APPROVAL')==='RESTORE-DISCORD-SMOKE-BASELINE-ONCE'&&
    val(w.bindings,'WATCHDOG_SMOKE_VERSION')===candidate&&
    val(w.bindings,'WATCHDOG_EXPIRES_AT')===String(expiry),'WATCHDOG_ARMING_REMOTE_UNVERIFIED');
  await waitForArm();
  await deploySmoke();
  await observe();
}
let error=null;
try{await main();}
catch(e){error=e;console.log('SMOKE_CONTROLLER_BLOCKED_'+e.message);}
finally{try{await cleanup();}catch(e){console.log('POST_SMOKE_CLEANUP_BLOCKED_'+e.message);error??=e;}}
if(success){
  const jobs=await jobState().catch(()=>[]);
  if(!jobs.some(j=>j.status==='completed'&&j.calls_used===6&&j.cycles===1))success=false;
}
console.log('SIX_ROLE_OWNER_TASK_SEEN='+jobSeen);
console.log('SIX_ROLE_SIX_CALLS_VERIFIED='+success);
console.log('DO_ALARM_OR_CRON_RESTORED_BASELINE='+restoredByAlarm);
console.log('ANY_MANUAL_EMERGENCY_POST='+postedFallback);
console.log('NO_YOUTUBE_NO_PLM_NO_OTHER_WORKER_DEPLOYMENTS');
if(error)throw error;
if(!success)throw Error('OWNER_AUTHENTICATED_SIX_CALL_TASK_NOT_COMPLETED');
if(!restoredByAlarm)throw Error('INDEPENDENT_WATCHDOG_RESTORE_NOT_PROVEN');
console.log('DISCORD_SIX_ROLE_INITIAL_SMOKE_END_TO_END_PASS');
