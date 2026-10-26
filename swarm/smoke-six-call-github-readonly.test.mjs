import test from 'node:test';
import assert from 'node:assert/strict';
import {collectGitHubSixCallReadOnly,EXPECTED_DRAFT_STACK,
 GITHUB_ACTIVE_RUN_STATUSES} from './smoke-six-call-github-readonly.mjs';

const now=Date.UTC(2026,9,26,11,30);
const mainSha='eeeebd6665e2384f32ed0a8e8014fd29ada29e0f';
const topSha='e149a1412e05bf0e33a06f63ee59dd0ed3811f8a';
const repo='https://api.github.com/repos/ikkinotako2-sketch/discord-gpt-relay-system';
const valid=()=>({
 expectedMainSha:mainSha,expectedTopHeadSha:topSha,clock:()=>now
});
function mock({active={},mutate=()=>null,failPath=null,onCall=()=>{}}={}){
 const calls=[];
 let mainReads=0;
 const fn=async (url,options)=>{
  assert.ok(url.startsWith(repo+'/'));
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Accept,'application/vnd.github+json');
  assert.equal(options.body,undefined);
  calls.push(url);
  onCall(url);
  if(failPath&&url.includes(failPath))return {status:503,ok:false,json:async()=>({})};
  let data;
  if(url.endsWith('/commits/main')){
   mainReads++;
   data={sha:mainSha};
  }else if(url.includes('/actions/runs?')){
   const status=new URL(url).searchParams.get('status');
   data={total_count:active[status]??0};
  }else if(/\/pulls\/\d+$/.test(url)){
   const num=Number(url.split('/').at(-1));
   const expected=EXPECTED_DRAFT_STACK.find(x=>x[0]===num);
   if(!expected)throw Error('UNEXPECTED_PR');
   data={number:num,state:'open',draft:true,merged:false,
    base:{ref:expected[1]},head:{ref:expected[2],
     sha:num===28?topSha:'a'.repeat(40)}};
  }else throw Error('UNEXPECTED_GITHUB_URL '+url);
  return {status:200,ok:true,json:async()=>mutate(url,data,{mainReads})||data};
 };
 return {fn,calls};
}
test('real-shaped GET-only report confirms 5 statuses and seven Draft PRs but never live',async()=>{
 const f=mock();
 const x=await collectGitHubSixCallReadOnly({...valid(),fetchImpl:f.fn});
 assert.equal(x.status,'GITHUB_ZERO_ACTIVE_UNMERGED_DRAFTS');
 assert.equal(x.source,'GITHUB_API_GET_RUN_COUNTS');
 assert.equal(x.activeCount,0);
 assert.equal(x.draftCount,7);
 assert.equal(x.stack[0].number,21);assert.equal(x.stack.at(-1).number,28);
 assert.equal(x.mainHeadMatched,true);
 assert.equal(x.draftPrsMergedInSafeOrder,false);
 assert.equal(x.authorizesLiveActions,false);
 assert.equal(x.authorizesDeployment,false);
 assert.equal(x.authorizesInference,false);
 assert.equal(f.calls.length,2+GITHUB_ACTIVE_RUN_STATUSES.length+EXPECTED_DRAFT_STACK.length);
 assert.ok(f.calls.every(u=>u.startsWith(repo+'/')));
});
test('a single queued or in-progress Action blocks safety check',async()=>{
 for(const active of [{queued:1},{in_progress:1},{waiting:1},{requested:1},{pending:1}]){
  const x=await collectGitHubSixCallReadOnly({...valid(),
   fetchImpl:mock({active}).fn});
  assert.equal(x.status,'GITHUB_ACTIONS_IN_PROGRESS_BLOCKED');
  assert.ok(x.activeCount>=1);
  assert.equal(x.authorizesInference,false);
 }
});
test('malformed, negative, absent, fractional run totals block',async()=>{
 for(const value of [-1,0.5,null,'0',undefined,Number.POSITIVE_INFINITY]){
  const f=mock({mutate:(url,d)=>{
   if(url.includes('status=queued'))return {total_count:value};
   return null;
  }});
  const x=await collectGitHubSixCallReadOnly({...valid(),fetchImpl:f.fn});
  assert.equal(x.status,'BLOCKED');
 }
});
test('wrong response code, rate limit, malformed response and network throw block',async()=>{
 for(const failPath of ['commits/main','status=pending','pulls/26']){
  assert.equal((await collectGitHubSixCallReadOnly({...valid(),
   fetchImpl:mock({failPath}).fn})).status,'BLOCKED');
 }
 const x=await collectGitHubSixCallReadOnly({...valid(),
  fetchImpl:async()=>{throw Error('network down')}});
 assert.equal(x.status,'BLOCKED');
});
test('main HEAD change between before/after read invalidates all evidence',async()=>{
 const f=mock({mutate:(url,d,{mainReads})=>{
  if(url.endsWith('/commits/main')&&mainReads===2)
   return {...d,sha:'a'.repeat(40)};
  return null;
 }});
 assert.equal((await collectGitHubSixCallReadOnly({...valid(),
  fetchImpl:f.fn})).reason,'MAIN_CHANGED_DURING_AUDIT');
});
test('main precondition is pinned and mismatching expected SHA blocks',async()=>{
 const x=await collectGitHubSixCallReadOnly({
  ...valid(),expectedMainSha:'b'.repeat(40),fetchImpl:mock().fn
 });
 assert.equal(x.reason,'MAIN_HEAD_DRIFT_OR_UNVERIFIED');
});
test('top Draft PR HEAD drift fails even if all CI queues are zero',async()=>{
 const f=mock({mutate:(url,d)=>url.endsWith('/pulls/28')?
  {...d,head:{...d.head,sha:'d'.repeat(40)}}:null});
 const x=await collectGitHubSixCallReadOnly({...valid(),fetchImpl:f.fn});
 assert.equal(x.reason,'CANDIDATE_HEAD_DRIFT');
});
test('merged/un-drafted, re-targeted or missing PR dependency blocks',async()=>{
 const patches=[
  {draft:false},{merged:true},{state:'closed'},
  {base:{ref:'main'}},{head:{sha:topSha,ref:'wrong'}},
  {number:99}
 ];
 for(const change of patches){
  const f=mock({mutate:(url,d)=>url.endsWith('/pulls/25')?{...d,...change}:null});
  const x=await collectGitHubSixCallReadOnly({...valid(),fetchImpl:f.fn});
  assert.equal(x.reason,'DRAFT_STACK_DRIFT_PR_25');
 }
});
test('readout taking >5 minutes is stale and cannot be reused',async()=>{
 let calls=0;
 const x=await collectGitHubSixCallReadOnly({
  ...valid(),fetchImpl:mock().fn,
  clock:()=>{calls++;return calls===1?now:now+6*60*1000;}
 });
 assert.equal(x.reason,'GITHUB_READS_EXPIRED');
});
test('clock rollback is blocked',async()=>{
 let calls=0;
 const x=await collectGitHubSixCallReadOnly({
  ...valid(),fetchImpl:mock().fn,
  clock:()=>{calls++;return calls===1?now:now-1;}
 });
 assert.equal(x.reason,'GITHUB_READS_EXPIRED');
});
test('invalid user-provided request URLs or SHA never use fetch',async()=>{
 let called=0;
 const fetchImpl=async()=>{called++;throw Error('should not fetch');};
 for(const patch of [
  {expectedMainSha:'xyz'},
  {expectedTopHeadSha:'xyz'},
  {expectedTopHeadSha:null},
  {clock:()=>0}
 ]){
  const x=await collectGitHubSixCallReadOnly({...valid(),...patch,fetchImpl});
  assert.equal(x.status,'BLOCKED');
 }
 assert.equal(called,0);
});
test('caller-supplied approval flags cannot cause read-only record to authorize AI',async()=>{
 const x=await collectGitHubSixCallReadOnly({...valid(),
  fetchImpl:mock().fn,ownerApproved:true,quotaVerified:true,
  authorizesInference:true});
 assert.equal(x.authorizesInference,false);
 assert.equal(x.authorizesDeployment,false);
});
