// Discord GPT Relay System V2 — OFFLINE ONLY. Never imported by production.
// Fixed capabilities are advisory: no model/Discord/Cloudflare/network/API calls.
export const V2_ROLES=Object.freeze(['researcher','designer','implementer','tester','auditor','manager']);
export const OFFLINE_REPAIR_CAP=2; // staging cap; independent of real six-call limit
export const REAL_AI_SMOKE_CAP=6;
export const REPO='ikkinotako2-sketch/discord-gpt-relay-system';
const ID=/^[A-Za-z0-9_-]{8,90}$/;
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const TYPES=Object.freeze(['CI_FAILED','ISSUE_OPENED','PR_UPDATED','TEST_CHANGED','APPROVAL_CHANGED','WATCHDOG_ANOMALY']);
const GRAPH=Object.freeze({manager:'researcher',researcher:'designer',designer:'implementer',implementer:'tester',tester:'auditor',auditor:'manager'});
const TOOLS=Object.freeze({
 researcher:Object.freeze(['read:issue','read:ci-log','read:source']),
 designer:Object.freeze(['read:issue','read:source','write:offline-plan']),
 implementer:Object.freeze(['read:source','write:isolated-branch','run:offline-test']),
 tester:Object.freeze(['read:source','run:offline-test']),
 auditor:Object.freeze(['read:source','read:ci-log','read:offline-proof']),
 manager:Object.freeze(['read:issue','read:offline-proof','write:draft-pr'])
});
const deny=reason=>Object.freeze({status:'BLOCKED',reason,authorizesLive:false,authorizesInference:false,authorizesDeployment:false,authorizesApproval:false});
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...fields].sort().join('|');
const text=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s);
const pathOK=p=>typeof p==='string'&&/^offline_v2\/[a-zA-Z0-9._/-]+$/.test(p)&&!p.includes('..')&&!p.includes('//');
const artifactOK=o=>exact(o,['path','digest'])&&text(o.path,180)&&/^(offline_v2|swarm)\/[a-zA-Z0-9._/-]+$/.test(o.path)&&!o.path.includes('..')&&!o.path.includes('//')&&DIGEST.test(o.digest);
const evidenceOK=o=>exact(o,['kind','ref','digest'])&&['GITHUB_CI','OFFLINE_TEST','SOURCE_REVIEW','HUMAN_REVIEW'].includes(o.kind)&&text(o.ref,170)&&!/\s|\/\//.test(o.ref)&&DIGEST.test(o.digest);
/** Bounded graph envelope: no raw logs or transcripts; no authority granted. */
export function validateHandoff(p){
 const fields=['task_id','run_id','from_role','to_role','objective','artifacts','evidence','constraints','current_status','next_action','approval_required'];
 if(!exact(p,fields)||!ID.test(p.task_id||'')||!ID.test(p.run_id||'')||
   !V2_ROLES.includes(p.from_role)||GRAPH[p.from_role]!==p.to_role||
   !text(p.objective,240)||!text(p.next_action,160)||
   !Array.isArray(p.artifacts)||p.artifacts.length>12||!p.artifacts.every(artifactOK)||
   !Array.isArray(p.evidence)||p.evidence.length>12||!p.evidence.every(evidenceOK)||
   !Array.isArray(p.constraints)||p.constraints.length<1||p.constraints.length>8||
   !p.constraints.every(x=>['NO_LIVE','NO_SECRETS','NO_UNKNOWN_RETRY','REQUIRE_OWNER_APPROVAL','ZERO_COST'].includes(x))||
   !['READY','REVIEW_REQUIRED','BLOCKED','UNKNOWN','COMPLETE'].includes(p.current_status)||
   typeof p.approval_required!=='boolean')return deny('HANDOFF_SCHEMA_OR_GRAPH_INVALID');
 return Object.freeze({...p,artifacts:Object.freeze(p.artifacts.map(x=>Object.freeze({...x}))),
  evidence:Object.freeze(p.evidence.map(x=>Object.freeze({...x}))),
  constraints:Object.freeze([...p.constraints]),
  authorizesLive:false,authorizesInference:false,authorizesDeployment:false,authorizesApproval:false});
}
/** An approval flag (including model-produced true) cannot expand this allowlist. */
export function canRoleUse(role,tool){
 return Object.freeze({allowed:V2_ROLES.includes(role)&&TOOLS[role].includes(tool),
   authorizesLive:false,authorizesApproval:false});
}
export function classifyCIText(log){
 if(typeof log!=='string'||log.length>16000)return deny('LOG_MISSING_OR_OVERSIZE');
 // Log text is not emitted. Ambiguous failures cannot automatically cause code edits.
 const flags=[['SCOPE_PROTECTION',/UNREVIEWED_\w+|Unexpected PR base or integration branch/],
   ['AUTH_REQUIRED',/HTTP\s*40[13]|PERMISSION_DENIED|credentials required/i],
   ['QUOTA',/rate limit|quota exceeded|free neurons/i],
   ['TEST_ASSERTION',/AssertionError|ERR_ASSERTION|not ok \d+/i]];
 const matches=flags.filter(([,re])=>re.test(log)).map(([kind])=>kind);
 const classification=matches.length===1?matches[0]:'UNKNOWN';
 return Object.freeze({classification,canAutofixOffline:classification==='TEST_ASSERTION',rawLogIncluded:false,authorizesLive:false});
}
export function eventKey(e){
 if(!exact(e,['repository','type','source_id','revision','head_sha'])||
   e.repository!==REPO||!TYPES.includes(e.type)||!ID.test(e.source_id||'')||
   !ID.test(e.revision||'')||!SHA.test(e.head_sha||''))return null;
 return [e.repository,e.type,e.source_id,e.revision,e.head_sha].join(':');
}
/** A review-only state-machine experiment.
 * Real D1 unique constraints, trusted event attestations, fencing, clock and
 * approval must be independently provided; THIS FILE DOES NOT PROVIDE THEM.
 * store.claimOnce and store.finish are injectable MOCK interfaces, no IO here.
 */
export async function runOfflineRepairCycle({event,store,diagnose,propose,test,audit,clock=Date.now}={}){
 const key=eventKey(event);
 if(!key||typeof store?.claimOnce!=='function'||typeof store?.finish!=='function'||
   typeof diagnose!=='function'||typeof propose!=='function'||typeof test!=='function'||
   typeof audit!=='function'||typeof clock!=='function')
   return deny('TRUSTED_OFFLINE_CAPABILITIES_MISSING');
 if(event.type!=='CI_FAILED')return deny('EVENT_REQUIRES_READONLY_OR_OWNER_REVIEW');
 let claim;
 try{claim=await store.claimOnce({key,maxAttempts:OFFLINE_REPAIR_CAP});}
 catch{return deny('CLAIM_OUTCOME_UNKNOWN_DO_NOT_RETRY');}
 if(!claim||claim.claimed!==true||claim.key!==key||!ID.test(claim.lease||'')||
    !Number.isSafeInteger(claim.attempt)||claim.attempt<1||claim.attempt>OFFLINE_REPAIR_CAP)
   return deny('DUPLICATE_OR_UNVERIFIED_LEASE');
 let outcome='UNKNOWN_STOP',classification='UNKNOWN',durationMs=null;
 try{
   const start=clock();
   if(!Number.isSafeInteger(start)||start<0)throw Error('CLOCK_INVALID');
   const d=await diagnose({key});
   classification=classifyCIText(d?.sanitizedLog).classification??'UNKNOWN';
   if(classification==='TEST_ASSERTION'&&d?.verifiedSource===true){
     const p=await propose({key,attempt:claim.attempt});
     if(p?.offlineOnly===true&&p.expectedHeadSha===event.head_sha&&
       Array.isArray(p.files)&&p.files.length>=1&&p.files.length<=6&&p.files.every(pathOK)){
       const t=await test({key,files:p.files});
       const a=await audit({key,files:p.files,testDigest:t?.digest});
       if(t?.status==='PASS'&&DIGEST.test(t.digest||'')&&a?.status==='PASS'&&a?.testDigest===t.digest)
         outcome='REVIEW_READY';
       else if(t?.status==='FAIL'&&a?.status==='FAIL')outcome='OFFLINE_FAILED';
     }
   }else if(classification!=='TEST_ASSERTION')outcome='BLOCKED';
   const end=clock();
   if(!Number.isSafeInteger(end)||end<start||end-start>1800000)outcome='UNKNOWN_STOP';
   else durationMs=end-start;
 }catch{/* Ambiguous attempt is terminal UNKNOWN; no blind retry. */}
 try{
   const result=await store.finish({key,lease:claim.lease,attempt:claim.attempt,outcome});
   if(result?.stored!==true||result.key!==key||result.attempt!==claim.attempt||result.outcome!==outcome)
     return deny('SETTLEMENT_UNVERIFIED_NO_RETRY');
 }catch{return deny('SETTLEMENT_UNKNOWN_DO_NOT_RETRY');}
 return Object.freeze({status:outcome,classification,offlineAttempt:claim.attempt,
   offlineRepairLimit:OFFLINE_REPAIR_CAP,realAiAttempts:0,durationMs,
   authorizesLive:false,authorizesInference:false,authorizesDeployment:false,authorizesApproval:false});
}