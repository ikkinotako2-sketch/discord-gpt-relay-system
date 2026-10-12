// Staged Discord slash-command + scheduled Worker entry point.
// Intentionally NOT active in wrangler.toml. Activate only after D1 isolation,
// owner allowlist, migration and protected release are all verified.
import previousWorker, {validDiscordRequest, respondToDiscord} from './worker-relay.mjs';
import {generateLoopStageWithWorkersAI,evaluateLoopFinalOutput,resolveLoopModel,GPT_OSS_MODEL} from './loop-quality.mjs';
import {createDurableLoop, getLatestLoop, requestDurableStop, claimOneLoopStep, commitLoopOutput, failLoopClaim} from './loop-d1.mjs';
import {handleDashboardRequest,dashboardConfigured} from './command-center/server.mjs';

const COMMANDS = new Set(['loop','loop-status','loop-stop']);
const say = content => String(content).slice(0,1900);
const option = (interaction,name) => interaction.data?.options?.find(x=>x.name===name)?.value;
const isOwner = (event,env) => /^\d{15,22}$/.test(String(env.DISCORD_ALLOWED_USER_ID ?? '')) &&
  String(event.member?.user?.id ?? event.user?.id ?? '')===String(env.DISCORD_ALLOWED_USER_ID);

function prettyStatus(row) {
  if (!row) return 'まだ実行履歴がありません。';
  const label={
    queued:'待機中',claimed:'AI処理中',completed:'完了',
    stopped:'停止済み',failed:'失敗（自動再試行なし）',
    unknown:'結果不明（安全のため自動再試行しません）'
  }[row.status] || '不明';
  const answer=row.status==='completed' && row.previous_artifact
    ? '\n【最終案】\n'+row.previous_artifact.slice(0,1100) : '';
  const quality=row.status==='failed' && row.last_error_code==='TASK_MISMATCH'
    ? '\n品質検査：元の依頼に沿った成果物を確認できなかったため、成功扱いせず停止しました。自動再試行はありません。' : '';
  const task = typeof row.task === 'string' ? row.task.slice(0, 180) : '未取得';
  return say(`run: ${row.run_id}\n元の依頼: ${task}\n状態: ${label}\n進捗: ${row.calls_used}/4 AI呼出し（最大2周）${quality}${answer}`);
}

export async function handleLoopCommand(event,env,now=Date.now()) {
  const name=event.data?.name;
  if (!COMMANDS.has(name)) throw Error('Unknown loop command');
  if (!isOwner(event,env)) return 'この機能は実験管理者専用です。';
  if (!env.LOOP_DB?.prepare) return '専用のD1データベースが未接続です。';
  if (name==='loop') {
    if (!env.AI?.run) return 'AIバインディングが未接続です。';
    const task=option(event,'task');
    if (typeof task!=='string'||!task.trim()||task.length>1000) return 'タスクは1〜1000文字で指定してください。';
    const runId='d'+event.id;
    const created=await createDurableLoop(env.LOOP_DB,{
      runId,requesterId:String(env.DISCORD_ALLOWED_USER_ID),task,now
    });
    if (created.busy) return 'ほかの実験が進行中です。/loop-status で確認してください。';
    return created.created
      ? `受付完了: ${runId}\n最大2周・4回のAI処理をバックグラウンドで順番に実行します。/loop-status で確認、/loop-stop で停止できます。`
      : `この操作はすでに受付済みです: ${runId}`;
  }
  if(name==='loop-stop'){
    const r=await requestDurableStop(env.LOOP_DB,String(env.DISCORD_ALLOWED_USER_ID),now);
    if(!r.found)return '停止対象の実行はありません。';
    return r.status==='stopped'?'次のAI処理を始めずに停止しました。'
      :'停止を予約しました。実行中のAI呼出しは完了を待ち、以後の呼出しを停止します。';
  }
  return prettyStatus(await getLatestLoop(env.LOOP_DB,String(env.DISCORD_ALLOWED_USER_ID)));
}

// Process one single AI call per cron tick. No retry on unknown outcomes.
// Model calls occur ONLY for an explicitly accepted /loop job.
export async function runOneScheduledLoopStep(env,{now=Date.now(),leaseOwner=crypto.randomUUID()}={}) {
  if(!env.LOOP_DB?.prepare || !env.AI?.run || !/^\d{15,22}$/.test(String(env.DISCORD_ALLOWED_USER_ID ?? ''))) throw Error('Missing loop bindings or operator');
  // Configuration verification BEFORE claiming/budgeting a model call.
  resolveLoopModel(env);
  const claim=await claimOneLoopStep(env.LOOP_DB,now,leaseOwner);
  if(!claim)return {status:'idle'};
  const context=claim.next_role==='planner'
    ? claim.previous_artifact ?? '' : claim.plan_output ?? '';
  let output;
  try {
    output=await generateLoopStageWithWorkersAI(env,{
      role:claim.next_role,task:claim.task,context
    });
  } catch {
    try {await failLoopClaim(env.LOOP_DB,claim,'MODEL_ERROR',Date.now());}
    catch {console.error('loop_failure_record_unavailable');}
    return {status:'failed'};
  }
  // Validate the final artifact without spending another model call.
  // Conservative greeting-task-only check: never silently mark an off-topic
  // completed greeting as successful. No automatic retries.
  if(claim.next_role==='builder' && claim.round_number>=claim.max_rounds){
    const quality=evaluateLoopFinalOutput(claim.task,output);
    if(!quality.ok){
      try {
        const recorded=await failLoopClaim(env.LOOP_DB,claim,'TASK_MISMATCH',Date.now());
        return {status:recorded?'failed':'unknown',reason:quality.reason};
      } catch {
        console.error('loop_quality_fail_record_unknown_no_retry');
        return {status:'unknown',reason:quality.reason};
      }
    }
  }
  try {
    const result=await commitLoopOutput(env.LOOP_DB,claim,output,Date.now());
    console.log(JSON.stringify({event:'loop_step',status:result.status,role:claim.next_role,round:claim.round_number}));
    return result;
  } catch {
    // DB commit might have succeeded before the response was lost. Do NOT retry.
    console.error('loop_commit_unknown_no_retry');
    return {status:'unknown'};
  }
}

export default {
  async fetch(request,env,ctx) {
    // Private dashboard route is entirely separate from signed Discord interactions.
    // Disabled by default: requires explicitly configured OAuth and session secrets.
    const pathname=new URL(request.url).pathname;
    if(pathname==='/command-center'||pathname.startsWith('/command-center/')){
      try{return await handleDashboardRequest(request,env);}
      catch{console.error('private_dashboard_request_failed');return new Response('Dashboard unavailable',{status:503});}
    }
    if(request.method==='GET') {
      if(!env.LOOP_DB?.prepare || !env.AI?.run || !/^\d{15,22}$/.test(String(env.DISCORD_ALLOWED_USER_ID ?? ''))) return new Response('Loop configuration incomplete',{status:503});
      try {
        const model=resolveLoopModel(env);
        await env.LOOP_DB.prepare('SELECT run_id FROM relay_loop_jobs LIMIT 1').first();
        if(env.DASHBOARD_ENABLED==='true' && !dashboardConfigured(env))
          return new Response('Private Command Center configuration incomplete',{status:503});
        return new Response(model===GPT_OSS_MODEL
          ? (dashboardConfigured(env)
            ? 'Discord GPT Relay gpt-oss command-center ready.'
            : 'Discord GPT Relay gpt-oss pilot ready.')
          : 'Discord GPT Relay loop-v2 task-focus ready.');
      } catch { return new Response('Loop configuration or D1 migration unavailable',{status:503}); }
    }
    if(request.method!=='POST')return previousWorker.fetch(request,env,ctx);
    if(!env.DISCORD_PUBLIC_KEY)return new Response('Missing public key',{status:503});
    const raw=await request.text();
    if(!(await validDiscordRequest(request,raw,env.DISCORD_PUBLIC_KEY)))
      return new Response('Invalid signature',{status:401});
    let event;
    try {event=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
    if(event.type===1)return Response.json({type:1});
    if(event.type===2 && COMMANDS.has(event.data?.name)){
      // Keep slash-command acknowledgement inside Discord's initial timeout.
      ctx.waitUntil((async()=>{
        let answer;
        try{answer=await handleLoopCommand(event,env);}
        catch{answer='実行処理に失敗しました。/loop-status で状態を確認してください。';}
        try{await respondToDiscord(event,env,say(answer));}
        catch{console.error('discord_loop_response_delivery_failed');}
      })());
      return Response.json({type:5,data:{flags:64}});
    }
    // Preserve existing /ask and /relay code, including its own signature check.
    return previousWorker.fetch(new Request(request.url,{
      method:'POST',headers:request.headers,body:raw
    }),env,ctx);
  },
  scheduled(controller,env,ctx) {
    ctx.waitUntil(runOneScheduledLoopStep(env).catch(()=>{
      console.error('discord_loop_cron_failed_no_retry');
    }));
  }
};
