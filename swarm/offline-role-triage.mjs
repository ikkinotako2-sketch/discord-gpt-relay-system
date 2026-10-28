// OFFLINE advisory triage only. Never imported by live Discord or Cloudflare code.
// This code CANNOT dispatch a model call, reserve quota, activate a worker or grant approval.
const ROLE_IDS=Object.freeze(['director','researcher','developer','reviewer','improver','archivist']);
const ROLE_MATCHERS=Object.freeze([
  ['researcher', /調査|リサーチ|情報収集|research|investigat|look\s?up/i],
  ['developer', /実装|コード修正|プログラム|デバッグ|implement|debug|\bfix\b|\bpatch\b|coding/i],
  ['reviewer', /レビュー|監査|検証|テスト|セキュリティ|\baudit\b|\breview\b|\btest\b|security/i],
  ['improver', /改善|最適化|高速化|\boptimi[sz]\w*|\brefactor\b|performance/i],
  ['archivist', /記録|要約|議事録|引き継ぎ資料|summari[sz]|archive|minutes/i],
  ['director', /計画|設計|分解|優先順位|\bplan\b|\bdesign\b|triage/i]
]);
const IMPACT = /本番|公開|投稿|デプロイ|課金|支払|削除|書き込|秘密|トークン|認証|権限|production|deploy|publish|billing|payment|secret|token|credential|permission|delete|migrat/i;
const advisory=(status,roleId,reason,requiresOwnerReview)=>Object.freeze({
  schema:'discord-role-triage.offline.v1',status,roleId,reason,requiresOwnerReview,
  roleIds:ROLE_IDS,modelCalls:0,estimatedProviderCostUsd:0,
  authorizesInference:false,authorizesDeployment:false,
  authorizesD1Write:false,authorizesApproval:false,
  changesSixCallOrder:false
});
/** Recommend a human-review lead for a bounded text description. No I/O or task text output.
 * This is NOT the six-call execution order: the staged real run stays 0..5.
 * Unsupported/ambiguous text fails closed to director-led human review.
 */
export function triageOfflineTask(task){
  if(typeof task!=='string'||!task.trim()||task.length>1000)
    return advisory('ABSTAIN',null,'INVALID_OR_OVERSIZE',true);
  const risky=IMPACT.test(task);
  const matches=ROLE_MATCHERS.filter(([,pattern])=>pattern.test(task)).map(([id])=>id);
  if(risky)return advisory('REVIEW_REQUIRED','reviewer','HIGH_IMPACT_REQUIRES_OWNER',true);
  if(matches.length!==1)return advisory('REVIEW_REQUIRED','director',matches.length?'AMBIGUOUS':'UNCLASSIFIED',true);
  return advisory('ADVISORY_ONLY',matches[0],'SINGLE_DETERMINISTIC_MATCH',false);
}
