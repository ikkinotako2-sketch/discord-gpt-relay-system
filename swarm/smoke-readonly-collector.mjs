// Read-only evidence collector for the exact Discord-only target.
// NOT a live launcher; never deploys, changes flags, migrates D1, or invokes AI.
// Cloudflare token + D1 Read token must be injected at execution time, never committed.
import {createDiscordCloudflareClient} from './smoke-restore-executor.mjs';
import {createDiscordD1ReadClient} from './smoke-watchdog-d1.mjs';
import {capturePreservedUnknownReadOnly,DISCORD_UNKNOWN_OWNER_COMMENT} from './smoke-historical-evidence-readonly.mjs';
import {verifyUnknownReviewComment} from './smoke-owner-approval.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {assessDiscordSmokePreflight,LIVE_READINESS_GATES} from './smoke-live-preflight.mjs';

const REPO='ikkinotako2-sketch/discord-gpt-relay-system';
const GITHUB='https://api.github.com/repos/'+REPO+'/actions/runs';
const ACTIVE=['queued','in_progress','waiting','pending','requested'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function okVersion(s){return typeof s==='string'&&UUID.test(s);}
const ACCOUNT_FIELDS=['plan','cronTriggers','neuronsUsed','neuronQuota','utcDay','usageCheckedAt',
 'usageSource','conservativeSixCallReservation','unrelatedAiJobsIdle'];
function safeAccount(account){
 if(!account||typeof account!=='object'||Array.isArray(account))return null;
 return Object.fromEntries(ACCOUNT_FIELDS.filter(k=>Object.hasOwn(account,k)).map(k=>[k,account[k]]));
}
function evidenceBindings(bindings){
 if(!Array.isArray(bindings))throw Error('VERSION_BINDINGS_NOT_ARRAY');
 // Only public safety metadata, NEVER secrets or arbitrary plain-text values.
 return bindings.filter(x=>x && (FLAGS.includes(x.name)||x.type==='d1'||x.name==='LOOP_DB'))
  .map(x=>({name:x.name,type:x.type,
   ...(x.type==='d1'?{database_id:x.database_id}:{}),
   ...(x.type==='plain_text'&&FLAGS.includes(x.name)?{text:x.text}:{})}));
}
export async function collectDiscordSmokeReadiness({
 cloudflareToken,d1ReadToken,baselineVersion,smokeVersion,fetchImpl=fetch,
 githubFetchImpl=fetchImpl,nowMs=Date.now(),accountEvidence=null
}={}){
 if(!okVersion(baselineVersion)||!okVersion(smokeVersion)||baselineVersion===smokeVersion)
  return {status:'BLOCKED',reason:'DISTINCT_PINNED_WORKER_VERSIONS_REQUIRED',authorizesLiveActions:false};
 if(!Number.isSafeInteger(nowMs)||nowMs<1e12)
  return {status:'BLOCKED',reason:'CLOCK_NOT_VERIFIED',authorizesLiveActions:false};
 // Deliberately no browser-secret scraping, quota assumptions, or live action.
 const evidence={
  target:{...DISCORD_SMOKE_TARGET},checkedAt:nowMs,
  versions:{baseline:baselineVersion,smoke:smokeVersion,deployment:null,active:null},
  remoteBindings:null,jobs:null,historicalUnknown:null,githubActiveRuns:null,account:safeAccount(accountEvidence),
  deadlineMs:null,
  gates:Object.fromEntries(LIVE_READINESS_GATES.map(x=>[x,false]))
 };
 const failures=[];
 function failed(key){if(!failures.includes(key))failures.push(key);}
 if(typeof cloudflareToken==='string'&&cloudflareToken.length>=8){
  try{
   const cf=createDiscordCloudflareClient({token:cloudflareToken,fetchImpl});
   const d=await cf.deployment();
   evidence.versions.deployment=d.deploymentId;
   evidence.versions.active=d.versionId;
   evidence.remoteBindings=evidenceBindings(await cf.bindings(d.versionId));
   // This confirms root health and unsigned signature rejection only.
   evidence.gates.unsignedDiscordSignatureRejects=await cf.health()===true;
  }catch{failed('CLOUDFLARE_READ_OR_SECURITY_CHECK_FAILED');}
 }else failed('CLOUDFLARE_READ_CREDENTIAL_MISSING');
 if(typeof d1ReadToken==='string'&&d1ReadToken.length>=8){
  try{
   const d1=createDiscordD1ReadClient({token:d1ReadToken,fetchImpl});
   const s=await d1.snapshot();
   evidence.jobs={legacyActive:s.legacyActive,swarmActive:s.swarmActive,
    unknownJobs:s.unknownJobs,pendingStop:s.pendingStop};
   if(s.unknownJobs===1&&s.legacyActive===0&&s.swarmActive===0&&s.pendingStop===0){
    try{
     const h=await capturePreservedUnknownReadOnly({d1ReadToken,fetchImpl,nowMs});
     const row=h.rows[0];
     const owner=await verifyUnknownReviewComment({
      ownerApprovalReference:DISCORD_UNKNOWN_OWNER_COMMENT,
      unknownCreatedAt:row.created_at,unknownUpdatedAt:row.updated_at,
      nowMs,fetchImpl:githubFetchImpl
     });
     evidence.historicalUnknown={
      rows:h.rows,dailyReserved:h.dailyReserved,dailyCap:h.dailyCap,
      utcDay:h.utcDay,ownerCommentVerified:owner.ownerCommentVerified===true,
      review:owner.ownerCommentVerified===true?owner.review:null
     };
     if(owner.ownerCommentVerified!==true)failed('HISTORICAL_OWNER_COMMENT_UNVERIFIED');
    }catch{failed('HISTORICAL_READ_ONLY_EVIDENCE_UNVERIFIED');}
   }
  }catch{failed('DISCORD_D1_READ_FAILED');}
 }else failed('DISCORD_D1_READ_CREDENTIAL_MISSING');
 if(typeof githubFetchImpl!=='function')failed('GITHUB_READ_CLIENT_MISSING');
 else try{
  let total=0;
  for(const status of ACTIVE){
   const url=GITHUB+'?status='+encodeURIComponent(status)+'&per_page=1';
   const resp=await githubFetchImpl(url,{method:'GET',
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(12000)});
   if(!resp.ok)throw Error('GITHUB_READ_FAILED');
   const data=await resp.json();
   if(!Number.isSafeInteger(data?.total_count)||data.total_count<0)
    throw Error('GITHUB_COUNT_MALFORMED');
   total+=data.total_count;
   if(!Number.isSafeInteger(total))throw Error('GITHUB_COUNT_OVERFLOW');
  }
  evidence.githubActiveRuns=total;
 }catch{failed('GITHUB_ACTIVE_WORKFLOWS_UNVERIFIED');}
 // No direct dashboard session, provider quota reservation, OAuth proof or
 // recovery authorization can be inferred from GETs. These remain unverified.
 const assessment=assessDiscordSmokePreflight(evidence,nowMs);
 return {status:assessment.status,blockers:[...new Set([...failures,...assessment.blockers])],
  authorizesLiveActions:false,
  evidence,source:'DISCORD_ONLY_READ_ONLY_COLLECTOR',
  note:'Does not prove live Cloudflare Free quota or approve any deployment, flag or inference.'};
}
