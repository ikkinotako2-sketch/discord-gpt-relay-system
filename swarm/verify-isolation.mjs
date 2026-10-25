// Offline-only isolation verification. Never uses Cloudflare or model inference.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const executable=schema.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
if(/\b(?:DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE|ATTACH|DETACH)\b/i.test(executable))
  throw Error('Unsafe D1 mutation in staged migration');
const tableNames=[...executable.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_]\w*)/g)].map(x=>x[1]);
if(tableNames.length!==2 || tableNames.some(n=>!n.startsWith('swarm_')))
  throw Error('Migration must create only two isolated swarm tables');
if(!/CREATE UNIQUE INDEX IF NOT EXISTS\s+swarm_single_active_job/.test(executable))
  throw Error('Missing one-active-job D1 guard');
if(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_BASE_REF){
  const base=process.env.GITHUB_BASE_REF;
  const stackedBase='feature/isolated-six-agent-command-center-20261012';
  const stackedHead='feature/swarm-six-role-safe-wiring-20261012';
  // Exactly one scoped safety-fix branch is allowed for emergency STOP/readiness.
  const safetyFixHead='fix/swarm-safe-stop-readonly-migration-preflight-20261012';
  const safetyFix=base==='main'&&process.env.GITHUB_HEAD_REF===safetyFixHead;
  const smokeFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-smoke-stop-gate-20261012';
  const priorIntegration=[stackedBase,'main'].includes(base)&&process.env.GITHUB_HEAD_REF===stackedHead;
  const autoOffGuard=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/swarm-smoke-safe-auto-off-20261013';
  const restoreExecutor=['feature/swarm-smoke-safe-auto-off-20261013','main'].includes(base)&&process.env.GITHUB_HEAD_REF==='feature/swarm-smoke-restore-executor-20261013';
  const independentWatchdog=['feature/swarm-smoke-restore-executor-20261013','main'].includes(base)&&process.env.GITHUB_HEAD_REF==='feature/swarm-independent-watchdog-20261013';
  const liveEvidence=['feature/swarm-independent-watchdog-20261013','main'].includes(base)&&process.env.GITHUB_HEAD_REF==='feature/swarm-live-preflight-evidence-20261013';
  const watchdogShadowFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-watchdog-loop-db-shadow-20261015';
  const prearmSafetyFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-prearm-before-deploy-20261022';
  const modelErrorSafetyFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-model-error-phase-no-retry-20261024';
  const unknownReviewFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-unknown-review-evidence-20261024';
  const shapeDiagnosticFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-response-shape-safe-diagnostics-20261024';
  const reviewedHistoricalPreflight=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-reviewed-unknown-preflight-20261024';
  const githubOwnerReviewFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/swarm-owner-review-github-proof-20261024';
  const readOnlyHistoricalFix=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-historical-unknown-readonly-20261025';
  if(!safetyFix&&!priorIntegration&&!smokeFix&&!autoOffGuard&&!restoreExecutor&&!independentWatchdog&&!liveEvidence&&!watchdogShadowFix&&!prearmSafetyFix&&!modelErrorSafetyFix&&!unknownReviewFix&&!shapeDiagnosticFix&&!reviewedHistoricalPreflight&&!githubOwnerReviewFix&&!readOnlyHistoricalFix)
    throw Error('Unexpected PR base or integration branch');
  const paths=execFileSync('git',['diff','--name-only','origin/'+base+'...HEAD'],{
    encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n').filter(Boolean);
  if(!paths.length)throw Error('No staged changes detected');
  const extra=new Set(['worker-loop.mjs','command-center/server.mjs',
    '.github/workflows/swarm-exclusive-integration-tests.yml']);
  const safetyFixPaths=new Set([
    'swarm/api.mjs','swarm/api.test.mjs','swarm/portal.mjs',
    'swarm/portal.test.mjs','swarm/verify-isolation.mjs',
    'swarm/MIGRATION_READINESS.md','swarm/schema-readiness.test.mjs',
    '.github/workflows/swarm-offline-tests.yml'
  ]);
  const smokeFiles=new Set(['swarm/portal.mjs','swarm/portal-client-stop.test.mjs','swarm/verify-isolation.mjs','swarm/portal.test.mjs','swarm/bridge.mjs','swarm/bridge.test.mjs','swarm/cron.mjs','swarm/cron.test.mjs','swarm/api.test.mjs','swarm/SMOKE_TEST_SAFE_RUNBOOK.md']);
  const autoOffFiles=new Set(['swarm/smoke-restore-guard.mjs','swarm/smoke-restore-guard.test.mjs','swarm/bridge.test.mjs','swarm/verify-isolation.mjs','swarm/SMOKE_TEST_SAFE_RUNBOOK.md']);
  const restoreExecutorFiles=new Set(['swarm/smoke-restore-executor.mjs','swarm/smoke-restore-executor.test.mjs','swarm/bridge.test.mjs','swarm/verify-isolation.mjs','swarm/SMOKE_TEST_SAFE_RUNBOOK.md']);
  const watchdogFiles=new Set(['swarm/smoke-watchdog-d1.mjs','swarm/smoke-watchdog-core.mjs','swarm/smoke-watchdog-worker.mjs','swarm/smoke-watchdog.test.mjs','swarm/wrangler.watchdog.example.toml','swarm/SMOKE_TEST_SAFE_RUNBOOK.md','swarm/bridge.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-watchdog-offline.yml']);
  const liveEvidencePaths=new Set(['swarm/smoke-live-preflight.mjs','swarm/smoke-live-preflight.test.mjs','swarm/smoke-readonly-collector.mjs','swarm/smoke-readonly-collector.test.mjs','swarm/smoke-watchdog-worker.mjs','swarm/smoke-watchdog-core.mjs','swarm/smoke-watchdog.test.mjs','swarm/smoke-watchdog-alarm.test.mjs','swarm/smoke-restore-executor.mjs','swarm/smoke-restore-executor.test.mjs','.github/workflows/swarm-watchdog-offline.yml','swarm/bridge.test.mjs','swarm/verify-isolation.mjs','swarm/SMOKE_TEST_SAFE_RUNBOOK.md']);
  const watchdogShadowFixPaths=new Set(['swarm/smoke-restore-executor.mjs','swarm/smoke-watchdog-core.mjs','swarm/smoke-restore-executor.test.mjs','swarm/smoke-watchdog.test.mjs','swarm/verify-isolation.mjs']);
  const prearmFixPaths=new Set(['swarm/smoke-watchdog-core.mjs','swarm/smoke-watchdog-worker.mjs','swarm/smoke-watchdog.test.mjs','swarm/smoke-watchdog-alarm.test.mjs','swarm/verify-isolation.mjs','swarm/SMOKE_TEST_SAFE_RUNBOOK.md']);
  const modelErrorFixPaths=new Set(['swarm/runner.mjs','swarm/runner.test.mjs','swarm/verify-isolation.mjs']);
  const unknownReviewPaths=new Set(['swarm/smoke-unknown-review.mjs','swarm/smoke-unknown-review.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-unknown-review-offline.yml']);
  const shapeDiagnosticPaths=new Set(['swarm/runner.mjs','swarm/model-result-diagnostics.mjs','swarm/model-result-diagnostics.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-offline-tests.yml']);
  const reviewedPreflightPaths=new Set(['swarm/smoke-live-preflight.mjs','swarm/smoke-live-preflight.test.mjs','swarm/verify-isolation.mjs']);
  const githubReviewPaths=new Set(['swarm/smoke-owner-approval.mjs','swarm/smoke-owner-approval.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-offline-tests.yml']);
  const readOnlyHistoricalPaths=new Set(['swarm/smoke-historical-evidence-readonly.mjs','swarm/smoke-historical-evidence-readonly.test.mjs','swarm/smoke-reviewed-unknown-safe-off.mjs','swarm/smoke-reviewed-unknown-safe-off.test.mjs','swarm/smoke-reviewed-unknown-safe-off-collector.mjs','swarm/smoke-reviewed-unknown-safe-off-collector.test.mjs','swarm/smoke-one-shot-offline-simulator.mjs','swarm/smoke-one-shot-offline-simulator.test.mjs','swarm/smoke-readonly-collector.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-offline-tests.yml']);
  const illegal=paths.filter(path=>readOnlyHistoricalFix ? !readOnlyHistoricalPaths.has(path) : githubOwnerReviewFix ? !githubReviewPaths.has(path) : reviewedHistoricalPreflight ? !reviewedPreflightPaths.has(path) : shapeDiagnosticFix ? !shapeDiagnosticPaths.has(path) : unknownReviewFix ? !unknownReviewPaths.has(path) : modelErrorSafetyFix ? !modelErrorFixPaths.has(path) : prearmSafetyFix ? !prearmFixPaths.has(path) : watchdogShadowFix ? !watchdogShadowFixPaths.has(path) : liveEvidence ? !liveEvidencePaths.has(path) : independentWatchdog ? !watchdogFiles.has(path) : restoreExecutor ? !restoreExecutorFiles.has(path) : autoOffGuard ? !autoOffFiles.has(path) : smokeFix ? !smokeFiles.has(path) : safetyFix
    ? !safetyFixPaths.has(path)
    : (path!=='.github/workflows/swarm-offline-tests.yml'&&
       !path.startsWith('swarm/')&&!extra.has(path)));
  if(illegal.length)throw Error('Protected production path touched: '+illegal.join(', '));
  process.stdout.write('ISOLATED_PR_PATHS_PASS '+paths.length+' changed files\n');
}
process.stdout.write('SWARM_OFFLINE_ISOLATION_PASS\n');
