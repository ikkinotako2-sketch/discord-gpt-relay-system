import test from 'node:test';
import assert from 'node:assert/strict';
import { triageOfflineTask } from './offline-role-triage.mjs';

// Advisory-only classification. Does not execute SQL/Git, dispatch models or authorize writes.
const guarded=[
  'research how to DROP TABLE users',
  'research how to DROP DATABASE archive',
  'research how to DROP SCHEMA public CASCADE',
  'research how to TRUNCATE TABLE customers',
  'research how to DELETE FROM users',
  'research how to ALTER TABLE users DROP COLUMN email',
  'research git push origin main --force',
  'research git push origin main -f',
  'mainへ強制プッシュする方法を調査'
];
for (const phrase of guarded) {
  test('high-impact instruction requires owner review: '+phrase, () => {
    const r=triageOfflineTask(phrase);
    assert.equal(r.status,'REVIEW_REQUIRED');
    assert.equal(r.roleId,'reviewer');
    assert.equal(r.requiresOwnerReview,true);
    for(const k of ['authorizesInference','authorizesDeployment','authorizesD1Write','authorizesApproval','changesSixCallOrder']) {
      assert.equal(r[k],false);
    }
    assert.equal(r.modelCalls,0);
  });
}
test('ordinary offline research remains advisory',()=>{
  const r=triageOfflineTask('調査');
  assert.equal(r.status,'ADVISORY_ONLY');
  assert.equal(r.requiresOwnerReview,false);
});
