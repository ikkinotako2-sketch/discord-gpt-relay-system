// GET/SELECT-only adapter for a SINGLE preserved Discord historical UNKNOWN.
// D1 REST uses POST as transport; the SQL is hard-coded SELECT and never mutates.
// This adapter NEVER authorizes AI calls, deployment, restoration, or D1 updates.
import {DISCORD_D1_URL} from './smoke-watchdog-d1.mjs';

const safeInt=x=>Number.isSafeInteger(x)&&x>=0;
const FIELDS=Object.freeze(['status','calls_used','cycles','stop_requested','active_slot',
  'last_error','created_at','updated_at','history_length','checkpoint_length']);
const ROW_SQL="SELECT status,calls_used,cycles,stop_requested,active_slot,last_error,created_at,updated_at,LENGTH(history_json) AS history_length,LENGTH(checkpoint) AS checkpoint_length FROM swarm_jobs WHERE status='unknown' ORDER BY created_at DESC LIMIT 2";

export const DISCORD_UNKNOWN_OWNER_COMMENT=
  'https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-6384216446';

export async function capturePreservedUnknownReadOnly({d1ReadToken,fetchImpl=fetch,nowMs=Date.now()}={}){
 if(typeof d1ReadToken!=='string'||d1ReadToken.length<8||typeof fetchImpl!=='function'||
    !safeInt(nowMs)||nowMs<1e12)throw Error('HISTORICAL_READ_INPUT_UNVERIFIED');
 const day=new Date(nowMs).toISOString().slice(0,10);
 const BUDGET_SQL="SELECT COALESCE(SUM(reserved),0) AS reserved FROM swarm_budget_days WHERE utc_day='"+day+"'";
 async function select(sql){
  let response,data;
  try{
   response=await fetchImpl(DISCORD_D1_URL,{
    method:'POST',
    headers:{Authorization:'Bearer '+d1ReadToken,'Content-Type':'application/json'},
    body:JSON.stringify({sql}),signal:AbortSignal.timeout(12000)
   });
   if(!response?.ok)throw Error('D1_READ_HTTP_UNVERIFIED');
   data=await response.json();
  }catch{throw Error('HISTORICAL_D1_READ_FAILED');}
  if(data?.success!==true||!Array.isArray(data.result)||data.result.length!==1||
     data.result[0]?.success!==true||!Array.isArray(data.result[0].results))
    throw Error('HISTORICAL_D1_RESULT_UNVERIFIED');
  return data.result[0].results;
 }
 const rows=await select(ROW_SQL);
 if(rows.length!==1||!rows[0]||typeof rows[0]!=='object')
  throw Error('HISTORICAL_UNKNOWN_NOT_EXACTLY_ONE');
 const budget=await select(BUDGET_SQL);
 if(budget.length!==1||!safeInt(budget[0]?.reserved))
  throw Error('CURRENT_UTC_DAY_BUDGET_UNVERIFIED');
 const row=Object.fromEntries(FIELDS.map(k=>[k,rows[0][k]]));
 return {
  checkedAt:nowMs,utcDay:day,rows:[row],
  dailyReserved:budget[0].reserved,dailyCap:6,
  authorizesLiveActions:false
 };
}
