// Read-only owner approval verifier for the exact Discord-only historical UNKNOWN.
// Source: real GitHub issue comment written by the repository owner.
// NEVER grants permission to deploy, mutate D1, or infer with Workers AI.
const REPO='ikkinotako2-sketch/discord-gpt-relay-system',OWNER='ikkinotako2-sketch';
const ISSUE='14';
export const EXACT_REVIEW_STATEMENT=
 '2026年10月24日のDiscord 6役割AIジョブ1件の結果がUNKNOWNであることを確認しました。元のジョブと予約回数を保持し、同じ呼び出しは再試行しません。次回の本番テストは安全検査後に別途承認します。';
const urlPattern=/^https:\/\/github\.com\/ikkinotako2-sketch\/discord-gpt-relay-system\/issues\/14#issuecomment-([1-9][0-9]{0,20})$/;
const okInt=x=>Number.isSafeInteger(x)&&x>=0;
const denied=reason=>({status:'BLOCKED',reason,ownerCommentVerified:false,authorizesLiveActions:false});
export async function verifyUnknownReviewComment({
 ownerApprovalReference,unknownCreatedAt,unknownUpdatedAt,nowMs=Date.now(),fetchImpl=fetch
}={}){
 const match=typeof ownerApprovalReference==='string'?urlPattern.exec(ownerApprovalReference):null;
 if(!match||!okInt(unknownCreatedAt)||!okInt(unknownUpdatedAt)||
   unknownUpdatedAt<unknownCreatedAt||!okInt(nowMs)||nowMs<unknownUpdatedAt||
   typeof fetchImpl!=='function')return denied('COMMENT_OR_INCIDENT_EVIDENCE_UNVERIFIED');
 const id=match[1];
 let body;
 try{
  const r=await fetchImpl('https://api.github.com/repos/'+REPO+'/issues/comments/'+id,{
   method:'GET',headers:{Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)return denied('COMMENT_READ_FAILED');
  body=await r.json();
 }catch{return denied('COMMENT_READ_FAILED');}
 if(String(body?.id)!==id||body?.html_url!==ownerApprovalReference)
  return denied('COMMENT_ID_OR_LOCATION_MISMATCH');
 if(typeof body?.user?.login!=='string'||body.user.login.toLowerCase()!==OWNER||
   body.author_association!=='OWNER')return denied('COMMENT_NOT_REPOSITORY_OWNER');
 if(typeof body.body!=='string'||body.body.trim()!==EXACT_REVIEW_STATEMENT)
  return denied('COMMENT_NOT_EXPLICIT_UNCERTAIN_REVIEW');
 const reviewedAt=Date.parse(body.created_at);
 if(!okInt(reviewedAt)||reviewedAt<=unknownUpdatedAt||reviewedAt>nowMs)
  return denied('OWNER_REVIEW_TIMESTAMP_UNVERIFIED');
 return {
  status:'OWNER_REVIEW_VERIFIED_NOT_EXECUTION_PERMISSION',ownerCommentVerified:true,
  authorizesLiveActions:false,
  review:{kind:'OWNER_REVIEWED_UNCERTAIN_NO_RETRY',reviewedAt,
   createdAt:unknownCreatedAt,updatedAt:unknownUpdatedAt,callsUsed:1,
   error:'MODEL_OUTCOME_UNKNOWN',ownerApprovalReference}
 };
}
