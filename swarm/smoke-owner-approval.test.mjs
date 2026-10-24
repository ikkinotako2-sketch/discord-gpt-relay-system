import test from 'node:test';
import assert from 'node:assert/strict';
import {EXACT_REVIEW_STATEMENT,verifyUnknownReviewComment} from './smoke-owner-approval.mjs';
const created=Date.UTC(2026,9,24,10,45),updated=created+60_000,now=Date.UTC(2026,9,25,1);
const url='https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-123456';
const goodBody=()=>({id:123456,html_url:url,user:{login:'ikkinotako2-sketch'},
 author_association:'OWNER',body:EXACT_REVIEW_STATEMENT,created_at:new Date(updated+30000).toISOString()});
const verify=(patch={},config={})=>verifyUnknownReviewComment({ownerApprovalReference:url,
 unknownCreatedAt:created,unknownUpdatedAt:updated,nowMs:now,
 fetchImpl:async(request,opts)=>{assert.equal(opts.method,'GET');
  assert.equal(request,'https://api.github.com/repos/ikkinotako2-sketch/discord-gpt-relay-system/issues/comments/123456');
  return {ok:true,json:async()=>({...goodBody(),...patch})};},...config});
test('exact repository owner review is verified without granting inference or deployments',async()=>{
 const result=await verify();
 assert.equal(result.ownerCommentVerified,true);
 assert.equal(result.authorizesLiveActions,false);
 assert.equal(result.review.callsUsed,1);
 assert.equal(result.review.error,'MODEL_OUTCOME_UNKNOWN');
});
for(const [name,patch,reason] of [
 ['other user',{user:{login:'random'}},'COMMENT_NOT_REPOSITORY_OWNER'],
 ['not owner association',{author_association:'COLLABORATOR'},'COMMENT_NOT_REPOSITORY_OWNER'],
 ['wrong body',{body:'I approve bypass of quota'},'COMMENT_NOT_EXPLICIT_UNCERTAIN_REVIEW'],
 ['other issue',{html_url:'https://github.com/elsewhere'},'COMMENT_ID_OR_LOCATION_MISMATCH'],
 ['mismatched id',{id:654321},'COMMENT_ID_OR_LOCATION_MISMATCH'],
 ['old review',{created_at:new Date(updated).toISOString()},'OWNER_REVIEW_TIMESTAMP_UNVERIFIED']
])test('fail-closed: '+name,async()=>{
 const result=await verify(patch);assert.equal(result.status,'BLOCKED');
 assert.equal(result.reason,reason);assert.equal(result.authorizesLiveActions,false);
});
test('no review comment URL never touches network',async()=>{
 let count=0;
 const result=await verify({}, {ownerApprovalReference:'https://evil.test/',fetchImpl:async()=>{count++;throw Error('should not fetch')}});
 assert.equal(count,0);assert.equal(result.status,'BLOCKED');
});
test('network or malformed JSON fails closed without logging raw content',async()=>{
 const result=await verify({}, {fetchImpl:async()=>{throw Error('PRIVATE api error')}});
 assert.deepEqual(result,{status:'BLOCKED',reason:'COMMENT_READ_FAILED',ownerCommentVerified:false,authorizesLiveActions:false});
});
