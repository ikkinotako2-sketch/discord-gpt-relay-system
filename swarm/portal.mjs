// Six-agent live portal: STAGED ONLY, NEVER imported by existing Worker.
// Explicit SWARM_API_ENABLED and owner Discord OAuth session required.
import {authenticateDashboard,dashboardConfigured,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
import {handleSwarmApi} from './api.mjs';
import {swarmModeEnabled} from './bridge.mjs';
const PAGE='/command-center/swarm';
const API='/command-center/api/swarm/';
const HTML=`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">
<title>NEON SWARM — Owner Control</title>
<style>
:root{font-family:system-ui,"Noto Sans JP",sans-serif;color:#f5eaff;background:#080710}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 45% -5%,#591a5460,transparent 55%),#080710}
.page{max-width:1400px;margin:auto;padding:17px;display:grid;gap:14px}
header,.panel{background:#120e1f;border:1px solid #79345f;border-radius:14px;box-shadow:0 0 25px #c8299611}
header{padding:22px;border-top:3px solid #f64fbd;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.overline{color:#ef8bd3;font:700 11px monospace;letter-spacing:2px}h1{color:#ff60c7;text-shadow:0 0 24px #e642ac50;font-size:clamp(24px,4vw,36px);margin:3px 0}
small,.muted{color:#ac9fb9}.pill{padding:8px 12px;border:1px solid #ec5bae;border-radius:30px;color:#f49ccf;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.cols{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(270px,1fr);gap:12px}
.panel{padding:17px;min-width:0}h2{font-size:15px;color:#fa89d5;letter-spacing:1px;margin:0 0 15px}
.value{font:700 clamp(19px,3vw,29px) monospace;color:#6df6db;margin-top:9px}.caption{font-size:12px;color:#aa9db8}
.agents{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.agent{padding:13px;border:1px solid #613454;border-radius:12px;text-align:center;background:linear-gradient(#32172b80,#160e22);min-height:142px}
.agent.active{border-color:#62ffe1;box-shadow:0 0 21px #52f7da30}.agent.done{border-color:#3f987e}
.agent .orb{font-size:27px;border:2px solid #ed4fb8;border-radius:50%;width:53px;height:53px;display:grid;place-items:center;margin:2px auto 8px;box-shadow:0 0 18px #f44db32b}
.agent.active .orb{border-color:#66f5d7;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 23px #61f9db91}}
.agent strong{display:block;font-size:13px}.agent p{font-size:11px;min-height:27px;color:#b2a2b9}.agent span{font:700 10px monospace;color:#70e8d1}
.bar{height:8px;border-radius:30px;background:#38253f;margin:14px 0;overflow:hidden}.fill{background:linear-gradient(90deg,#fd54c7,#67f1e5);height:100%;width:0;transition:width .2s}
label{display:block;color:#c9b4d2;font-size:12px;margin:12px 0 5px}input,select{width:100%;border:1px solid #6d4569;background:#0f0b18;color:#fff;border-radius:8px;padding:11px;font:inherit}
button{background:#763063;color:#fff;border:1px solid #f65bc2;border-radius:8px;padding:10px 13px;cursor:pointer;font-weight:700}
button:disabled{opacity:.45;cursor:not-allowed}.danger{background:#6e2538;border-color:#fa8488}.secondary{background:#22192d;border-color:#735371}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}
pre{white-space:pre-wrap;word-break:break-word;font:12px/1.65 monospace;background:#0b101b;border:1px solid #334858;border-radius:8px;padding:14px;min-height:70px;max-height:260px;overflow:auto;color:#c2f0e6}
.notice{font-size:12px;color:#e7c791;line-height:1.7}
@media(max-width:900px){.cols{grid-template-columns:1fr}}@media(max-width:600px){.grid{grid-template-columns:repeat(2,1fr)}.agents{grid-template-columns:repeat(2,1fr)}.page{padding:10px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head>
<body><div class="page"><header><div><div class="overline">DISCORD RELAY LAB / PRIVATE OWNER DASHBOARD</div>
<h1>NEON SWARM</h1><small>6-ROLE AI ORCHESTRATION · AUTHENTICATED DATA</small></div>
<span class="pill" id="authStatus">● 状態確認中</span></header>
<div class="grid">
<section class="panel"><span class="caption">処理状態</span><div class="value" id="state">読込中</div></section>
<section class="panel"><span class="caption">処理数</span><div class="value" id="calls">—</div></section>
<section class="panel"><span class="caption">改善サイクル</span><div class="value" id="cycle">—</div></section>
<section class="panel"><span class="caption">本番AI連携</span><div class="value" id="model">未接続</div></section>
</div>
<div class="cols"><section class="panel"><h2>◈ 6 AGENTS · ACTUAL D1 STATUS</h2>
<div class="agents" id="agents"></div><div class="bar"><div class="fill" id="progress"></div></div>
<div class="notice" id="policy">登録された作業だけを実行する設計です。未接続時は操作できません。</div>
</section>
<section class="panel"><h2>▣ OWNER CONTROLS</h2>
<label for="task">仕事の目標</label><input id="task" maxlength="1000" value="Bluesky自動化の設計・テスト計画を作成する">
<label for="cycles">改善サイクル上限</label><select id="cycles"><option value="1">1周（最大6回）</option><option value="2">2周（最大12回）</option><option value="3">3周（最大18回）</option></select>
<div class="actions"><button id="create" disabled>新しいタスク</button><button id="stop" class="danger" disabled>緊急STOP</button>
<button id="resume" class="secondary" disabled>利用枠回復後に再開</button><button id="refresh" class="secondary">更新</button>
<button id="handoff" class="secondary">引き継ぎ内容をコピー</button><button id="download" class="secondary">引き継ぎJSON保存</button></div>
<p class="notice" id="feedback">Discordの本人認証と独立したAI実行許可が必要です。</p>
</section></div>
<div class="cols"><section class="panel"><h2>⌁ HANDOFF / CHECKPOINT</h2><pre id="checkpoint">最新の作業はまだありません。</pre></section>
<section class="panel"><h2>☷ CONFIRMED EXECUTION HISTORY</h2><pre id="history">履歴を読み込んでいます。</pre></section></div>
<section class="panel"><p class="notice">この画面はログインした所有者の専用D1データだけを表示します。6体のAIは6種類の「役割」であり、6つのChatGPT会話ではありません。推論回数・無料枠・API利用制限がなくなるわけではありません。YouTubeやProject Love Machineとは別管理です。</p></section>
</div>
<script>
(()=>{
'use strict';
const roleLabels=[['🧠','司令塔AI','計画と安全条件'],['🔎','調査AI','必要情報の整理'],['💻','開発AI','コード・設計'],['🛡️','検証AI','品質と安全検証'],['🛠️','改善AI','改善策の作成'],['💾','記憶AI','要点・再開情報の保存']];
const $=id=>document.getElementById(id);
let csrf='',job=null,runner=false;
function text(id,v){$(id).textContent=String(v)}
function renderAgents(n=0,mode='idle'){
 $('agents').replaceChildren();
 roleLabels.forEach((a,i)=>{
   const node=document.createElement('div');node.className='agent';
   const index=n%6;
   node.classList.toggle('active',mode==='claimed'&&i===Math.max(0,(n-1)%6));
   node.classList.toggle('done',mode==='completed'||(i<index&&n>0));
   const orb=document.createElement('div');orb.className='orb';orb.textContent=a[0];
   const name=document.createElement('strong');name.textContent=a[1];
   const desc=document.createElement('p');desc.textContent=a[2];
   const tag=document.createElement('span');tag.textContent=mode==='claimed'&&i===(n-1)%6?'PROCESSING':mode==='completed'?'DONE':i<index?'DONE':'READY';
   node.append(orb,name,desc,tag);$('agents').append(node);
 });
}
function setButtons(){
 $('create').disabled=!runner||!!job&&['queued','claimed','quota_wait'].includes(job.status);
 // STOP remains accessible while execution flags are OFF; it cannot invoke the model.
 $('stop').disabled=!job||!['queued','claimed','quota_wait'].includes(job.status);
 $('resume').disabled=!runner||!job||job.status!=='quota_wait';
}
async function refresh(){
 try{
 const response=await fetch('/command-center/api/swarm/overview',{credentials:'same-origin',cache:'no-store'});
 if(response.status===401){location.assign('/command-center/login');return}
 if(!response.ok)throw Error('HTTP '+response.status);
 const data=await response.json();
 if(data.schema!=='discord-swarm.v1')throw Error('API schema mismatch');
 csrf=data.csrfToken||'';job=data.jobs?.[0]||null;runner=data.runnerEnabled===true;
 text('authStatus','● 管理者認証済み / D1接続');
 text('state',job?.status||'待機');
 text('calls',job?job.callsUsed+' / '+job.callsMax:'0 / 0');
 text('cycle',job?Math.min(job.cycles,Math.floor(job.callsUsed/6)+1)+' / '+job.cycles:'—');
 text('model',data.modelLinked?'接続確認':'未検証');
 $('progress').style.width=job?Math.round(100*job.callsUsed/job.callsMax)+'%':'0%';
 text('checkpoint',job?.lastCheckpoint||'保存済みチェックポイントなし');
 text('history',job?.history?.map(h=>'['+h.stage.label+'] '+h.output).join('\\n\\n')||'確定した実行履歴はありません');
 text('policy',runner?'認証済みジョブのみ。実際のモデル接続状況は別途検証してください。':'本番AI実行は禁止されています。閲覧のみ利用できます。');
 setButtons();
 }catch(e){text('authStatus','● 読込エラー');text('feedback','読み込み失敗: '+e.message);runner=false;setButtons()}
}
async function act(action,body){
 // Emergency STOP must remain actionable while the AI runner is disabled.
 // Creating/resuming work stays gated by all four execution flags.
 if(!csrf||(action!=='stop'&&!runner))return;
 try{
 const response=await fetch('/command-center/api/swarm/'+action,{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
   body:JSON.stringify(body||{})});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'HTTP '+response.status);
 text('feedback','操作を受け付けました: '+action);
 await refresh();
 }catch(e){text('feedback','操作されませんでした: '+e.message)}
}
$('create').onclick=()=>act('create',{task:$('task').value,cycles:Number($('cycles').value)});
$('stop').onclick=()=>act('stop',{});
$('resume').onclick=()=>{if(job)act('resume',{runId:job.id})};
$('refresh').onclick=refresh;
async function handoff(download){
 try{
  const res=await fetch('/command-center/api/swarm/handoff',{credentials:'same-origin',cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  const packet=await res.json();
  if(packet.schema!=='discord-swarm.handoff.v1')throw Error('Invalid handoff packet');
  if(download){
   const blob=new Blob([JSON.stringify(packet,null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='swarm-handoff.json';a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   text('feedback','引き継ぎJSONを保存しました。');
  }else{
   try{await navigator.clipboard.writeText(packet.markdown);text('feedback','引き継ぎ内容をコピーしました。')}
   catch{text('checkpoint',packet.markdown);text('feedback','コピーできないため、引き継ぎ文を画面に表示しました。')}
  }
 }catch(e){text('feedback','引き継ぎの出力に失敗: '+e.message)}
}
$('handoff').onclick=()=>handoff(false);
$('download').onclick=()=>handoff(true);
renderAgents();refresh();
setInterval(()=>{if(!document.hidden)refresh()},15000);
})();
</script></body></html>`;
const staticHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
async function digest(value){
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 return 'sha256-'+btoa(String.fromCharCode(...hash));
}
export async function renderPrivateSwarmPage(){
 const css=HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 const js=HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 if(!css||!js)throw Error('Swarm page assets missing');
 const [cssHash,jsHash]=await Promise.all([digest(css),digest(js)]);
 const csp="default-src 'none'; script-src '"+jsHash+"'; style-src '"+cssHash+
   "'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
 return new Response(HTML,{status:200,headers:{...staticHeaders,
  'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
}
export async function handleSwarmRoute(request,env){
 const url=new URL(request.url);
 if(url.origin!==COMMAND_CENTER_ORIGIN)return new Response('Not found',{status:404});
 if(url.pathname.startsWith(API))return handleSwarmApi(request,env);
 if(url.pathname!==PAGE&&url.pathname!==PAGE+'/')return new Response('Not found',{status:404});
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 if(env?.SWARM_API_ENABLED!=='true'||!dashboardConfigured(env))
   return new Response('Swarm dashboard unavailable',{status:503});
 const session=await authenticateDashboard(request,env);
 if(!session)return new Response(null,{status:302,headers:{...staticHeaders,Location:'/command-center/login'}});
 return renderPrivateSwarmPage();
}
