// Read-only D1 preflight output validator. NEVER invokes Cloudflare or writes state.
// Strictly accept one successful COUNT(*) statement on the isolated Discord D1.
// Used by the guarded release only; no behavior change to the live Worker.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function assertZeroActiveJobs(raw){
  if(typeof raw!=='string'||raw.length>100000)throw Error('D1_PREFLIGHT_INVALID_OUTPUT');
  let d;
  try{d=JSON.parse(raw)}catch{throw Error('D1_PREFLIGHT_INVALID_JSON')}
  if(!Array.isArray(d)||d.length!==1)throw Error('D1_PREFLIGHT_UNEXPECTED_RESULT_COUNT');
  const only=d[0];
  if(only?.success!==true||!Array.isArray(only.results)||only.results.length!==1)
    throw Error('D1_PREFLIGHT_QUERY_NOT_CONFIRMED');
  const row=only.results[0];
  if(!row||Array.isArray(row)||typeof row!=='object'||Object.keys(row).length!==1||
    !Object.hasOwn(row,'active_jobs'))
    throw Error('D1_PREFLIGHT_UNEXPECTED_ROW');
  if(!Number.isSafeInteger(row.active_jobs)||row.active_jobs<0)
    throw Error('D1_PREFLIGHT_INVALID_ACTIVE_COUNT');
  if(row.active_jobs!==0)throw Error('D1_PREFLIGHT_BLOCKED_ACTIVE_JOBS');
  return {status:'pass',active_jobs:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw Error('Usage: node release-d1-guard.mjs <D1-JSON-FILE>');
  const output=readFileSync(process.argv[2],'utf8');
  assertZeroActiveJobs(output);
  console.log('DISCORD_D1_ACTIVE_JOB_PREFLIGHT_PASS count=0; read-only query confirmed');
}
