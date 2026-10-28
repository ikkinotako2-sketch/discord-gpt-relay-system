import test from 'node:test';
import assert from 'node:assert/strict';
import {triageOfflineTask} from './offline-role-triage.mjs';
const cases=[
 ['日本語の調査をしてください','researcher'],
 ['コード修正をしてください','developer'],
 ['オフラインのテストを確認','reviewer'],
 ['処理を最適化したい','improver'],
 ['作業を要約してください','archivist'],
 ['優先順位を計画してください','director'],
 ['research topic','researcher'],
 ['refactor the code','improver']
];
test('fixed offline fixture routes without model calls or mutations',()=>{
 for(const [task,expected] of cases){
  const r=triageOfflineTask(task);
  assert.equal(r.roleId,expected,task);
  assert.equal(r.status,'ADVISORY_ONLY');
  assert.equal(r.modelCalls,0);
  assert.equal(r.estimatedProviderCostUsd,0);
  for(const k of ['authorizesInference','authorizesDeployment','authorizesD1Write','authorizesApproval','changesSixCallOrder'])assert.equal(r[k],false);
 }
});
test('high impact operations require human review despite apparently simple task',()=>{
 for(const s of ['本番デプロイ','削除','secret token','production publish','D1を書き込む','権限を変更']){
  const x=triageOfflineTask(s);
  assert.equal(x.status,'REVIEW_REQUIRED');assert.equal(x.requiresOwnerReview,true);
  assert.equal(x.roleId,'reviewer');assert.equal(x.authorizesApproval,false);
 }
});
test('ambiguous, unclassified or malformed text abstains to human review',()=>{
 for(const s of ['', '   ', null, 42, 'a'.repeat(1001)]){
  const x=triageOfflineTask(s);
  assert.equal(x.status,'ABSTAIN');assert.equal(x.requiresOwnerReview,true);
 }
 assert.equal(triageOfflineTask('テストのコード修正').reason,'AMBIGUOUS');
 assert.equal(triageOfflineTask('よろしく').reason,'UNCLASSIFIED');
});
test('no raw user task text is returned or logged',()=>{
 const privateMarker='REDACT_THIS_TEST_MARKER';
 const output=JSON.stringify(triageOfflineTask('調査 '+privateMarker));
 assert.equal(output.includes(privateMarker),false);
 assert.equal(Object.isFrozen(triageOfflineTask('調査')),true);
});
test('advisory routing never changes the required six stage order',()=>{
 const ids=triageOfflineTask('調査').roleIds;
 assert.deepEqual([...ids],['director','researcher','developer','reviewer','improver','archivist']);
 assert.equal(Object.isFrozen(ids),true);
});
