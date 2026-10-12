// Owner-only handoff packet. This does NOT create/replace consumer ChatGPT chats.
// It gives a future authorized conversation enough saved context to resume manually.
const safe=(s,max=2200)=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max).trim();
export function buildSwarmHandoff(snapshot,{now=Date.now()}={}){
 if(snapshot?.schema!=='discord-swarm.v1'||!Array.isArray(snapshot.jobs))
   throw TypeError('Untrusted swarm snapshot');
 const j=snapshot.jobs[0]||null;
 const history=j?.history?.slice(-18).filter(x=>x?.stage&&typeof x.output==='string').map(x=>({
   role:safe(x.stage.label,64),
   cycle:Number(x.stage.cycle)||1,
   output:safe(x.output,1600)
 }))||[];
 const active=j&&['queued','claimed','quota_wait'].includes(j.status);
 const requiresReview=j?.status==='unknown';
 const packet={
   schema:'discord-swarm.handoff.v1',
   generatedAt:new Date(now).toISOString(),
   source:'discord-gpt-relay-system',
   provider:'Cloudflare Workers AI pilot; exact provider for this job not independently verified',
   runId:j?.id||null,
   task:j?safe(j.task,1000):null,
   status:j?.status||'idle',
   stepsConfirmed:j?.callsUsed||0,
   stepsMaximum:j?.callsMax||0,
   nextRole:active?j?.stage?.label||null:null,
   latestCheckpoint:j?safe(j.lastCheckpoint,2200):null,
   needsManualReview:!!requiresReview,
   history,
   pendingActions:requiresReview?
     ['実行結果が不明です。重複したAI処理を自動実行せず、保存済み記録を照合してください。']:
     active?['認証済み管理画面で利用枠・停止状態・次の担当を確認してください。']:
     ['新しいジョブを開始する場合は管理者として明示的に承認してください。']
 };
 const lines=[
   '# Discord Swarm — 作業引き継ぎ',
   '- 作成日時: '+packet.generatedAt,
   '- run_id: '+(packet.runId||'なし'),
   '- 状態: '+packet.status,
   '- 完了ステップ: '+packet.stepsConfirmed+'/'+packet.stepsMaximum,
   '- 次の担当: '+(packet.nextRole||'なし'),
   '',
   '## 元の目的',
   packet.task||'作業なし',
   '',
   '## 最後に保存できた作業結果',
   packet.latestCheckpoint||'まだありません。',
   '',
   '## AIごとの確定済み記録',
   ...history.flatMap(h=>['### '+h.role+' / cycle '+h.cycle,h.output,'']),
   '## 次の作業',
   ...packet.pendingActions.map(a=>'- '+a),
   '',
   'これはAIの処理記録をまとめた文書であり、ChatGPT会話そのものを自動作成・引き継ぎするものではありません。',
   '本番公開・外部SNS投稿・課金は、この文書だけで許可されたことにはなりません。'
 ];
 return {...packet,markdown:lines.join('\n').slice(0,36000)};
}
