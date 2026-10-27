// READ-ONLY OFFLINE-STAGED GitHub pre-release evidence collector.
// Only GET against this exact public GitHub repository; NEVER starts an Action,
// comments, merges, deploys, uses private tokens, writes D1 or invokes AI.
const REPO='ikkinotako2-sketch/discord-gpt-relay-system';
const ROOT='https://api.github.com/repos/'+REPO;
const STATUSES=Object.freeze(['queued','in_progress','waiting','pending','requested']);
const SHA=/^[a-f0-9]{40}$/;
const freshMs=x=>Number.isSafeInteger(x)&&x>=1e12;
const denied=(reason)=>Object.freeze({status:'BLOCKED',reason,
 authorizesLiveActions:false,authorizesDeployment:false,
 authorizesInference:false});
const DRAFT_STACK=Object.freeze([
 [21,'main','feature/discord-historical-unknown-readonly-20261025'],
 [23,'feature/discord-historical-unknown-readonly-20261025','feature/discord-six-call-controller-20261026'],
 [24,'feature/discord-six-call-controller-20261026','feature/discord-six-call-d1-store-20261026'],
 [25,'feature/discord-six-call-d1-store-20261026','feature/discord-six-call-owner-prepare-20261026'],
 [26,'feature/discord-six-call-owner-prepare-20261026','feature/discord-six-call-safe-stop-reconcile-20261026'],
 [27,'feature/discord-six-call-safe-stop-reconcile-20261026','feature/discord-six-call-release-fence-20261026'],
 [28,'feature/discord-six-call-release-fence-20261026','feature/discord-six-call-provider-quota-evidence-20261026'],
 [29,'feature/discord-six-call-provider-quota-evidence-20261026','feature/discord-six-call-github-readonly-20261026'],
 [30,'feature/discord-six-call-github-readonly-20261026','feature/discord-six-call-d1-readonly-audit-20261027'],
 [31,'feature/discord-six-call-d1-readonly-audit-20261027','feature/discord-six-call-worker-get-audit-20261027'],
 [32,'feature/discord-six-call-worker-get-audit-20261027','feature/discord-six-call-cross-evidence-20261027'],
 [33,'feature/discord-six-call-cross-evidence-20261027','feature/discord-six-call-d1-ddl-integrity-20261027'],
 [34,'feature/discord-six-call-d1-ddl-integrity-20261027','feature/discord-six-call-postclaim-stop-20261027']
]);
export const EXPECTED_DRAFT_STACK=DRAFT_STACK;
export const GITHUB_ACTIVE_RUN_STATUSES=STATUSES;

export async function collectGitHubSixCallReadOnly({
 expectedMainSha,expectedTopHeadSha,extraDrafts=[],fetchImpl=fetch,clock=Date.now
}={}){
 if(!SHA.test(expectedMainSha||'')||!SHA.test(expectedTopHeadSha||'')||
    typeof fetchImpl!=='function'||typeof clock!=='function')
  return denied('PINNED_GITHUB_SHA_OR_READER_MISSING');
 // Additional reviewed Draft PRs can extend the pinned chain without
 // deleting any of the thirteen original required links. Caller-supplied
 // names are NOT trustworthy: every link is verified against GitHub GET.
 if(!Array.isArray(extraDrafts)||extraDrafts.length>12)
  return denied('UNREVIEWED_EXTRA_DRAFT_SCOPE');
 let previous=DRAFT_STACK.at(-1);
 const extensions=[];
 for(const candidate of extraDrafts){
  if(!candidate||Object.keys(candidate).sort().join(',')!=='head,number'||
     !Number.isSafeInteger(candidate.number)||candidate.number<=previous[0]||
     candidate.number>5000||typeof candidate.head!=='string'||
     !/^feature\\/discord-six-call-[a-z0-9-]+-20[0-9]{6}$/.test(candidate.head)||
     candidate.head===previous[2])
   return denied('EXTRA_DRAFT_CHAIN_UNPINNED');
  const tuple=[candidate.number,previous[2],candidate.head];
  extensions.push(tuple);
  previous=tuple;
 }
 const fullStack=[...DRAFT_STACK,...extensions];
 let start;
 try{start=clock();}catch{return denied('CLOCK_UNVERIFIED');}
 if(!freshMs(start))return denied('CLOCK_UNVERIFIED');
 async function get(path){
  const url=ROOT+path;
  let response,body;
  try{
   response=await fetchImpl(url,{method:'GET',
    headers:{Accept:'application/vnd.github+json',
     'X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(12000)});
   if(response?.status!==200||response?.ok!==true)
    throw Error('GITHUB_GET_UNVERIFIED');
   body=await response.json();
  }catch{throw Error('GITHUB_GET_UNVERIFIED');}
  return body;
 }
 try{
  const before=await get('/commits/main');
  if(before?.sha!==expectedMainSha)
   return denied('MAIN_HEAD_DRIFT_OR_UNVERIFIED');
  const raw=[];
  let activeCount=0;
  for(const status of STATUSES){
   const data=await get('/actions/runs?status='+status+'&per_page=1');
   if(!Number.isSafeInteger(data?.total_count)||data.total_count<0)
    return denied('GITHUB_RUN_COUNT_UNVERIFIED_'+status.toUpperCase());
   activeCount+=data.total_count;
   if(!Number.isSafeInteger(activeCount))return denied('GITHUB_TOTAL_COUNT_OVERFLOW');
   raw.push(Object.freeze({status,activeCount:data.total_count}));
  }
  const stack=[];
  for(const [n,base,head] of fullStack){
   const p=await get('/pulls/'+n);
   if(p?.number!==n||p?.state!=='open'||p?.draft!==true||
      p?.merged===true||p?.base?.ref!==base||p?.head?.ref!==head||
      p?.head?.repo?.full_name!==REPO||
      p?.base?.repo?.full_name!==REPO||
      !SHA.test(p?.head?.sha||''))
    return denied('DRAFT_STACK_DRIFT_PR_'+n);
   stack.push(Object.freeze({number:n,base,head,headSha:p.head.sha,
    state:'DRAFT_NOT_MERGED'}));
  }
  if(stack.at(-1).headSha!==expectedTopHeadSha)
   return denied('CANDIDATE_HEAD_DRIFT');
  const after=await get('/commits/main');
  if(after?.sha!==expectedMainSha||after.sha!==before.sha)
   return denied('MAIN_CHANGED_DURING_AUDIT');
  // Count active runs again AFTER the PR sweep; a new CI execution during
  // collection must never be returned as "zero active" on stale early counts.
  let activeAfter=0;
  for(const status of STATUSES){
   const second=await get('/actions/runs?status='+status+'&per_page=1');
   if(!Number.isSafeInteger(second?.total_count)||second.total_count<0)
    return denied('GITHUB_SECOND_RUN_COUNT_UNVERIFIED_'+status.toUpperCase());
   activeAfter+=second.total_count;
   if(!Number.isSafeInteger(activeAfter))
    return denied('GITHUB_TOTAL_COUNT_OVERFLOW');
  }
  let end;
  try{end=clock();}catch{return denied('CLOCK_UNVERIFIED');}
  if(!freshMs(end)||end<start||end-start>5*60*1000)
   return denied('GITHUB_READS_EXPIRED');
  return Object.freeze({
   status:activeCount===0&&activeAfter===0?'GITHUB_ZERO_ACTIVE_UNMERGED_DRAFTS':
    'GITHUB_ACTIONS_IN_PROGRESS_BLOCKED',
   source:'GITHUB_API_GET_RUN_COUNTS',
   repository:REPO,activeCount:Math.max(activeCount,activeAfter),
   activeCountBefore:activeCount,activeCountAfter:activeAfter,counts:raw,
   checkedAtMs:end,expectedMainSha,expectedTopHeadSha,
   draftCount:stack.length,stack,fullyReviewedDraftChain:true,
   draftPrsMergedInSafeOrder:false,
   mainHeadMatched:true,
   authorizesLiveActions:false,authorizesDeployment:false,
   authorizesInference:false,
   note:'GitHub-only non-atomic GET snapshot; draft stack unmerged, external Cloudflare/D1 and provider quota unverified.'
  });
 }catch{return denied('GITHUB_GET_OR_RESPONSE_UNVERIFIED');}
}
