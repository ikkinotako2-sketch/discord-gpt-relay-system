// Offline-only evidence review for a preserved UNKNOWN model attempt.
// This module NEVER authorizes inference, retries, D1 writes or a production deploy.
const valid=x=>Number.isSafeInteger(x)&&x>=0;
export function assessHistoricalUnknown({snapshot,rows,review,nowMs=Date.now(),dailyReserved,dailyCap=6}={}){
 const issues=[],deny=x=>{if(!issues.includes(x))issues.push(x);};
 if(!valid(nowMs)||nowMs<1e12)deny('CLOCK_INVALID');
 if(!snapshot||!['legacyActive','swarmActive','unknownJobs','pendingStop'].every(k=>valid(snapshot[k])))
   deny('D1_SNAPSHOT_UNKNOWN');
 else{
  if(snapshot.legacyActive!==0||snapshot.swarmActive!==0||snapshot.pendingStop!==0)deny('ACTIVE_JOB_OR_STOP_PENDING');
  if(snapshot.unknownJobs!==1)deny('EXACTLY_ONE_HISTORICAL_UNKNOWN_REQUIRED');
 }
 const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
 if(!row)deny('D1_UNKNOWN_EVIDENCE_NOT_UNIQUE');
 else{
  if(row.status!=='unknown'||row.last_error!=='MODEL_OUTCOME_UNKNOWN'||row.calls_used!==1||
    row.cycles!==1||row.active_slot!==null||row.stop_requested!==0||
    !valid(row.created_at)||!valid(row.updated_at)||row.updated_at<row.created_at||
    row.history_length!==2||row.checkpoint_length!==0)
    deny('UNKNOWN_ROW_CHANGED_OR_UNVERIFIED');
  if(valid(nowMs)&&new Date(row.created_at).toISOString().slice(0,10)>=new Date(nowMs).toISOString().slice(0,10))
    deny('SAME_UTC_DAY_LOCAL_CAP_NOT_REFRESHED');
 }
 const ref=review?.ownerApprovalReference;
 if(!review||review.kind!=='OWNER_REVIEWED_UNCERTAIN_NO_RETRY'||!valid(review.reviewedAt)||
   review.reviewedAt>nowMs||!row||review.createdAt!==row.created_at||
   review.updatedAt!==row.updated_at||review.callsUsed!==1||
   review.error!=='MODEL_OUTCOME_UNKNOWN'||typeof ref!=='string'||
   !/^https:\/\/github\.com\/ikkinotako2-sketch\/discord-gpt-relay-system\/issues\/14#issuecomment-[0-9]+$/.test(ref))
   deny('EXPLICIT_OWNER_AUDIT_REVIEW_REQUIRED');
 if(!valid(dailyReserved)||dailyReserved!==0||dailyCap!==6)deny('NEW_DAY_SIX_CALL_BUDGET_NOT_ZERO');
 return {status:issues.length?'BLOCKED':'REVIEWED_HISTORICAL_UNKNOWN_NEEDS_ALL_LIVE_PREFLIGHTS',
   blockers:issues,authorizesLiveActions:false,
   note:'The original UNKNOWN stays immutable; no inferred success or free quota authorization.'};
}
