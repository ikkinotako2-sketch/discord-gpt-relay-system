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
  const sixCallController=base==='feature/discord-historical-unknown-readonly-20261025'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-controller-20261026';
  const sixCallD1=base==='feature/discord-six-call-controller-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-d1-store-20261026';
  const ownerPrepare=base==='feature/discord-six-call-d1-store-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-owner-prepare-20261026';
  const safeStop=base==='feature/discord-six-call-owner-prepare-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-safe-stop-reconcile-20261026';
  const releaseFence=base==='feature/discord-six-call-safe-stop-reconcile-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-release-fence-20261026';
  const quotaReview=base==='feature/discord-six-call-release-fence-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-provider-quota-evidence-20261026';
  const githubReadOnly=base==='feature/discord-six-call-provider-quota-evidence-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-github-readonly-20261026';
  const d1ReadOnly=base==='feature/discord-six-call-github-readonly-20261026'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-d1-readonly-audit-20261027';
  const workerGet=base==='feature/discord-six-call-d1-readonly-audit-20261027'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-worker-get-audit-20261027';
  const crossEvidence=base==='feature/discord-six-call-worker-get-audit-20261027'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-cross-evidence-20261027';
  const ddlIntegrity=base==='feature/discord-six-call-cross-evidence-20261027'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-d1-ddl-integrity-20261027';
  const postClaimStop=base==='feature/discord-six-call-d1-ddl-integrity-20261027'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-postclaim-stop-20261027';
  const reviewedFinalBundle=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-postclaim-stop-20261027';
  const freeOnlyReview=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-free-only-budget-evidence-20261027';
  const providerBoundary=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-provider-boundary-20261027';
  const outputD1Review=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-output-d1-20261027';
  const ownerTaskSourceReview=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-owner-task-source-20261028';
  const elevenObjectAudit=base==='main'&&process.env.GITHUB_HEAD_REF==='feature/discord-six-call-eleven-object-d1-audit-20261028';
  const combinedUnknownAndElevenD1Review=base==='main'&&process.env.GITHUB_HEAD_REF==='review/discord-six-call-unknown-d1-integrated-20261028';
  const combinedUnknownD1AndProviderClockReview=base==='main'&&process.env.GITHUB_HEAD_REF==='review/discord-six-call-unknown-d1-provider-clock-integrated-20261028';
  const postClaimRowDriftFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/offline-postclaim-state-drift-20261028';
  const ownerPrepareAsyncFix=base==='main'&&process.env.GITHUB_HEAD_REF==='fix/offline-owner-prepare-async-review-20261028';
  const taskRegistrationReview=base==='main'&&['feature/discord-owner-task-registration-offline-20261028','fix/offline-owner-review-async-timestamp-20261028','fix/offline-owner-task-pending-window-cas-20261028'].includes(process.env.GITHUB_HEAD_REF);
  if(!safetyFix&&!priorIntegration&&!smokeFix&&!autoOffGuard&&!restoreExecutor&&!independentWatchdog&&!liveEvidence&&!watchdogShadowFix&&!prearmSafetyFix&&!modelErrorSafetyFix&&!unknownReviewFix&&!shapeDiagnosticFix&&!reviewedHistoricalPreflight&&!githubOwnerReviewFix&&!readOnlyHistoricalFix&&!sixCallController&&!sixCallD1&&!ownerPrepare&&!safeStop&&!releaseFence&&!quotaReview&&!githubReadOnly&&!d1ReadOnly&&!workerGet&&!crossEvidence&&!ddlIntegrity&&!postClaimStop&&!reviewedFinalBundle&&!freeOnlyReview&&!providerBoundary&&!outputD1Review&&!ownerTaskSourceReview&&!elevenObjectAudit&&!combinedUnknownAndElevenD1Review&&!combinedUnknownD1AndProviderClockReview&&!taskRegistrationReview&&!postClaimRowDriftFix&&!ownerPrepareAsyncFix)
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
  const sixCallFiles=new Set(['swarm/smoke-six-call-controller.mjs','swarm/smoke-six-call-controller.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-six-call-controller-offline.yml','swarm/SMOKE_SIX_CALL_CONTROLLER_STATUS.md']);
  const sixCallD1Files=new Set(['swarm/smoke-six-call-d1-schema.review.sql','swarm/smoke-six-call-d1-store.mjs','swarm/smoke-six-call-d1-store.test.mjs','swarm/verify-isolation.mjs','.github/workflows/swarm-six-call-d1-store-offline.yml','swarm/SMOKE_SIX_CALL_D1_STATUS.md']);
  const ownerPrepareFiles=new Set([
    'swarm/smoke-six-call-owner-prepare.mjs',
    'swarm/smoke-six-call-owner-prepare.test.mjs',
    'swarm/smoke-six-call-owner-prepare-index.review.sql',
    'swarm/SMOKE_SIX_CALL_OWNER_PREPARE_STATUS.md',
    'swarm/verify-isolation.mjs',
    '.github/workflows/swarm-six-call-owner-prepare-offline.yml'
  ]);
  const safeStopFiles=new Set([
    'swarm/smoke-six-call-d1-schema.review.sql',
    'swarm/smoke-six-call-d1-store.mjs',
    'swarm/smoke-six-call-controller.mjs',
    'swarm/smoke-six-call-reconcile.mjs',
    'swarm/smoke-six-call-stop-reconcile.test.mjs',
    'swarm/smoke-six-call-owner-stop.mjs',
    'swarm/smoke-six-call-owner-stop.test.mjs',
    'swarm/smoke-six-call-owner-prepare.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_SAFE_STOP_STATUS.md',
    '.github/workflows/swarm-six-call-safe-stop-offline.yml'
  ]);
  const releaseFenceFiles=new Set([
    'swarm/smoke-six-call-release-fence.mjs',
    'swarm/smoke-six-call-release-fence.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_RELEASE_FENCE_STATUS.md',
    '.github/workflows/swarm-six-call-release-fence-offline.yml'
  ]);
  const quotaReviewFiles=new Set([
    'swarm/smoke-six-call-free-neuron-review.mjs',
    'swarm/smoke-six-call-free-neuron-review.test.mjs',
    'swarm/smoke-six-call-readiness-report.mjs',
    'swarm/smoke-six-call-readiness-report.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_FREE_NEURON_READINESS.md',
    '.github/workflows/swarm-six-call-quota-evidence-offline.yml'
  ]);
  const githubReadOnlyFiles=new Set([
    'swarm/smoke-six-call-github-readonly.mjs',
    'swarm/smoke-six-call-github-readonly.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_GITHUB_READONLY_STATUS.md',
    '.github/workflows/swarm-six-call-github-readonly-offline.yml'
  ]);
  const d1ReadOnlyFiles=new Set([
    'swarm/smoke-six-call-d1-readonly-audit.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_REMOTE_D1_READONLY_STATUS.md',
    '.github/workflows/swarm-six-call-d1-readonly-audit-offline.yml'
  ]);
  const workerGetFiles=new Set([
    'swarm/smoke-six-call-worker-get-audit.mjs',
    'swarm/smoke-six-call-worker-get-audit.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_WORKER_GET_STATUS.md',
    '.github/workflows/swarm-six-call-worker-get-offline.yml'
  ]);
  const crossEvidenceFiles=new Set([
    'swarm/smoke-six-call-cross-evidence.mjs',
    'swarm/smoke-six-call-cross-evidence.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_CROSS_EVIDENCE_STATUS.md',
    '.github/workflows/swarm-six-call-cross-evidence-offline.yml'
  ]);
  const ddlIntegrityFiles=new Set([
    'swarm/smoke-six-call-d1-ddl-digest.mjs',
    'swarm/smoke-six-call-d1-ddl-digest.test.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_D1_DDL_INTEGRITY.md',
    '.github/workflows/swarm-six-call-d1-ddl-integrity-offline.yml'
  ]);
  const postClaimStopFiles=new Set([
    'swarm/smoke-six-call-controller.mjs',
    'swarm/smoke-six-call-postclaim-stop.test.mjs',
    'swarm/smoke-six-call-migration-acceptance.test.mjs',
    'swarm/smoke-six-call-github-readonly.mjs',
    'swarm/smoke-six-call-github-readonly.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_POSTCLAIM_STOP_REVIEW.md',
    '.github/workflows/swarm-six-call-postclaim-stop-offline.yml'
  ]);
  // One-time cumulative offline-only integration after reviewed #21.
  // Exact 55 paths from main..final SHA, no prod entrypoint or live workflow.
  const reviewedBundleFiles=new Set([
    ".github/workflows/swarm-six-call-controller-offline.yml",
    ".github/workflows/swarm-six-call-cross-evidence-offline.yml",
    ".github/workflows/swarm-six-call-d1-ddl-integrity-offline.yml",
    ".github/workflows/swarm-six-call-d1-readonly-audit-offline.yml",
    ".github/workflows/swarm-six-call-d1-store-offline.yml",
    ".github/workflows/swarm-six-call-github-readonly-offline.yml",
    ".github/workflows/swarm-six-call-owner-prepare-offline.yml",
    ".github/workflows/swarm-six-call-postclaim-stop-offline.yml",
    ".github/workflows/swarm-six-call-quota-evidence-offline.yml",
    ".github/workflows/swarm-six-call-release-fence-offline.yml",
    ".github/workflows/swarm-six-call-safe-stop-offline.yml",
    ".github/workflows/swarm-six-call-worker-get-offline.yml",
    "swarm/SMOKE_SIX_CALL_CONTROLLER_STATUS.md",
    "swarm/SMOKE_SIX_CALL_CROSS_EVIDENCE_STATUS.md",
    "swarm/SMOKE_SIX_CALL_D1_DDL_INTEGRITY.md",
    "swarm/SMOKE_SIX_CALL_D1_STATUS.md",
    "swarm/SMOKE_SIX_CALL_FREE_NEURON_READINESS.md",
    "swarm/SMOKE_SIX_CALL_GITHUB_READONLY_STATUS.md",
    "swarm/SMOKE_SIX_CALL_OWNER_PREPARE_STATUS.md",
    "swarm/SMOKE_SIX_CALL_POSTCLAIM_STOP_REVIEW.md",
    "swarm/SMOKE_SIX_CALL_RELEASE_FENCE_STATUS.md",
    "swarm/SMOKE_SIX_CALL_REMOTE_D1_READONLY_STATUS.md",
    "swarm/SMOKE_SIX_CALL_SAFE_STOP_STATUS.md",
    "swarm/SMOKE_SIX_CALL_WORKER_GET_STATUS.md",
    "swarm/smoke-six-call-controller.mjs",
    "swarm/smoke-six-call-controller.test.mjs",
    "swarm/smoke-six-call-cross-evidence.mjs",
    "swarm/smoke-six-call-cross-evidence.test.mjs",
    "swarm/smoke-six-call-d1-ddl-digest.mjs",
    "swarm/smoke-six-call-d1-ddl-digest.test.mjs",
    "swarm/smoke-six-call-d1-readonly-audit.mjs",
    "swarm/smoke-six-call-d1-readonly-audit.test.mjs",
    "swarm/smoke-six-call-d1-schema.review.sql",
    "swarm/smoke-six-call-d1-store.mjs",
    "swarm/smoke-six-call-d1-store.test.mjs",
    "swarm/smoke-six-call-free-neuron-review.mjs",
    "swarm/smoke-six-call-free-neuron-review.test.mjs",
    "swarm/smoke-six-call-github-readonly.mjs",
    "swarm/smoke-six-call-github-readonly.test.mjs",
    "swarm/smoke-six-call-migration-acceptance.test.mjs",
    "swarm/smoke-six-call-owner-prepare-index.review.sql",
    "swarm/smoke-six-call-owner-prepare.mjs",
    "swarm/smoke-six-call-owner-prepare.test.mjs",
    "swarm/smoke-six-call-owner-stop.mjs",
    "swarm/smoke-six-call-owner-stop.test.mjs",
    "swarm/smoke-six-call-postclaim-stop.test.mjs",
    "swarm/smoke-six-call-readiness-report.mjs",
    "swarm/smoke-six-call-readiness-report.test.mjs",
    "swarm/smoke-six-call-reconcile.mjs",
    "swarm/smoke-six-call-release-fence.mjs",
    "swarm/smoke-six-call-release-fence.test.mjs",
    "swarm/smoke-six-call-stop-reconcile.test.mjs",
    "swarm/smoke-six-call-worker-get-audit.mjs",
    "swarm/smoke-six-call-worker-get-audit.test.mjs",
    "swarm/verify-isolation.mjs"
]);
  if(reviewedFinalBundle&&(paths.length!==reviewedBundleFiles.size||
      new Set(paths).size!==paths.length))
    throw Error('Cumulative offline integration file count differs from reviewed SHA');
  const freeOnlyReviewFiles=new Set([
    'swarm/smoke-free-only-planning.mjs',
    'swarm/smoke-free-only-planning.test.mjs',
    'swarm/SMOKE_FREE_ONLY_READINESS.md',
    '.github/workflows/swarm-free-only-planning-offline.yml',
    'swarm/verify-isolation.mjs'
  ]);
  const providerBoundaryFiles=new Set([
    'swarm/smoke-six-call-provider-adapter.mjs',
    'swarm/smoke-six-call-provider-adapter.test.mjs',
    'swarm/SMOKE_PROVIDER_BOUNDARY_READINESS.md',
    '.github/workflows/swarm-six-call-provider-boundary-offline.yml',
    '.github/workflows/swarm-free-only-planning-offline.yml',
    'swarm/verify-isolation.mjs'
  ]);
  const outputD1Files=new Set([
    'swarm/smoke-six-call-output-artifacts.review.sql',
    'swarm/smoke-six-call-output-d1.mjs',
    'swarm/smoke-six-call-output-d1.test.mjs',
    'swarm/SMOKE_SIX_CALL_OUTPUT_D1_READINESS.md',
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-provider-boundary-offline.yml',
    '.github/workflows/swarm-free-only-planning-offline.yml',
    'swarm/verify-isolation.mjs'
  ]);
  const ownerTaskSourceFiles=new Set([
    'swarm/smoke-six-call-owner-task-source.review.sql',
    'swarm/smoke-six-call-owner-task-source.mjs',
    'swarm/smoke-six-call-owner-task-source.test.mjs',
    'swarm/SMOKE_SIX_CALL_OWNER_TASK_READINESS.md',
    'swarm/verify-isolation.mjs',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml',
    '.github/workflows/swarm-six-call-output-d1-offline.yml'
  ]);
  const elevenObjectAuditFiles=new Set([
    'swarm/SMOKE_SIX_CALL_D1_DDL_INTEGRITY.md',
    'swarm/smoke-six-call-cross-evidence.mjs',
    'swarm/smoke-six-call-cross-evidence.test.mjs',
    'swarm/smoke-six-call-d1-ddl-digest.mjs',
    'swarm/smoke-six-call-d1-ddl-digest.test.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.test.mjs',
    'swarm/smoke-six-call-migration-acceptance.test.mjs',
    'swarm/verify-isolation.mjs',
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml'
  ]);
  const combinedUnknownAndElevenD1Files=new Set([
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml',
    'swarm/SMOKE_SIX_CALL_D1_DDL_INTEGRITY.md',
    'swarm/smoke-six-call-cross-evidence.mjs',
    'swarm/smoke-six-call-cross-evidence.test.mjs',
    'swarm/smoke-six-call-d1-ddl-digest.mjs',
    'swarm/smoke-six-call-d1-ddl-digest.test.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.mjs',
    'swarm/smoke-six-call-d1-readonly-audit.test.mjs',
    'swarm/smoke-six-call-migration-acceptance.test.mjs',
    'swarm/smoke-six-call-owner-task-source.mjs',
    'swarm/smoke-six-call-owner-task-source.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_UNKNOWN_D1_COMBINED_REVIEW.md',
  ]);
  const combinedUnknownD1AndProviderClockFiles=new Set([
            ".github/workflows/swarm-six-call-output-d1-offline.yml",
            ".github/workflows/swarm-six-call-owner-task-source-offline.yml",
            ".github/workflows/swarm-six-call-provider-boundary-offline.yml",
            "swarm/SMOKE_SIX_CALL_D1_DDL_INTEGRITY.md",
            "swarm/SMOKE_SIX_CALL_UNKNOWN_D1_COMBINED_REVIEW.md",
            "swarm/SMOKE_PROVIDER_BOUNDARY_READINESS.md",
            "swarm/smoke-six-call-cross-evidence.mjs",
            "swarm/smoke-six-call-cross-evidence.test.mjs",
            "swarm/smoke-six-call-d1-ddl-digest.mjs",
            "swarm/smoke-six-call-d1-ddl-digest.test.mjs",
            "swarm/smoke-six-call-d1-readonly-audit.mjs",
            "swarm/smoke-six-call-d1-readonly-audit.test.mjs",
            "swarm/smoke-six-call-migration-acceptance.test.mjs",
            "swarm/smoke-six-call-owner-task-source.mjs",
            "swarm/smoke-six-call-owner-task-source.test.mjs",
            "swarm/smoke-six-call-provider-adapter.mjs",
            "swarm/smoke-six-call-provider-adapter.test.mjs",
            "swarm/verify-isolation.mjs",
          ]);
  if(combinedUnknownD1AndProviderClockReview&&
    (paths.length!==combinedUnknownD1AndProviderClockFiles.size||
     new Set(paths).size!==combinedUnknownD1AndProviderClockFiles.size))
    throw Error('COMBINED_UNKNOWN_D1_PROVIDER_CLOCK_EXACT_SCOPE_MISMATCH');
  if(combinedUnknownAndElevenD1Review&&
    (paths.length!==combinedUnknownAndElevenD1Files.size||
     new Set(paths).size!==combinedUnknownAndElevenD1Files.size))
    throw Error('COMBINED_UNKNOWN_D1_EXACT_SCOPE_MISMATCH');
  const taskRegistrationFiles=new Set([
    'swarm/smoke-six-call-owner-task-register.mjs',
    'swarm/smoke-six-call-owner-task-register.test.mjs',
    'swarm/SMOKE_OWNER_TASK_REGISTER_REVIEW.md',
    'swarm/verify-isolation.mjs',
    '.github/workflows/swarm-owner-task-register-offline.yml',
    '.github/workflows/swarm-six-call-provider-boundary-offline.yml',
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml'
  ]);
  const ownerPrepareAsyncFiles=new Set([
    'swarm/smoke-six-call-owner-prepare.mjs',
    'swarm/smoke-six-call-owner-prepare.test.mjs',
    'swarm/SMOKE_SIX_CALL_OWNER_PREPARE_STATUS.md',
    'swarm/verify-isolation.mjs',
    '.github/workflows/swarm-six-call-provider-boundary-offline.yml',
    '.github/workflows/swarm-owner-task-register-offline.yml',
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml'
  ]);
  const postClaimRowDriftFiles=new Set([
    'swarm/smoke-six-call-controller.mjs',
    'swarm/smoke-six-call-controller.test.mjs',
    'swarm/verify-isolation.mjs',
    'swarm/SMOKE_SIX_CALL_CONTROLLER_STATUS.md',
    '.github/workflows/swarm-six-call-owner-task-source-offline.yml',
    '.github/workflows/swarm-six-call-output-d1-offline.yml',
    '.github/workflows/swarm-six-call-provider-boundary-offline.yml',
    '.github/workflows/swarm-owner-task-register-offline.yml'
  ]);
  if(ownerPrepareAsyncFix&&
    (paths.length!==ownerPrepareAsyncFiles.size||
     new Set(paths).size!==ownerPrepareAsyncFiles.size))
    throw Error('OWNER_PREPARE_ASYNC_EXACT_EIGHT_FILE_SCOPE_MISMATCH');
  if(postClaimRowDriftFix&&
    (paths.length!==postClaimRowDriftFiles.size||
     new Set(paths).size!==postClaimRowDriftFiles.size))
    throw Error('POSTCLAIM_ROW_DRIFT_EXACT_EIGHT_FILE_SCOPE_MISMATCH');
  if(taskRegistrationReview&&
    (paths.length!==taskRegistrationFiles.size||
     new Set(paths).size!==taskRegistrationFiles.size))
    throw Error('OWNER_TASK_EXACT_EIGHT_FILE_SCOPE_MISMATCH');
  const illegal=paths.filter(path=>ownerPrepareAsyncFix ? !ownerPrepareAsyncFiles.has(path) : postClaimRowDriftFix ? !postClaimRowDriftFiles.has(path) : taskRegistrationReview ? !taskRegistrationFiles.has(path) : combinedUnknownD1AndProviderClockReview ? !combinedUnknownD1AndProviderClockFiles.has(path) : combinedUnknownAndElevenD1Review ? !combinedUnknownAndElevenD1Files.has(path) : elevenObjectAudit ? !elevenObjectAuditFiles.has(path) : ownerTaskSourceReview ? !ownerTaskSourceFiles.has(path) : outputD1Review ? !outputD1Files.has(path) : providerBoundary ? !providerBoundaryFiles.has(path) : freeOnlyReview ? !freeOnlyReviewFiles.has(path) : reviewedFinalBundle ? !reviewedBundleFiles.has(path) : postClaimStop ? !postClaimStopFiles.has(path) : ddlIntegrity ? !ddlIntegrityFiles.has(path) : crossEvidence ? !crossEvidenceFiles.has(path) : workerGet ? !workerGetFiles.has(path) : d1ReadOnly ? !d1ReadOnlyFiles.has(path) : githubReadOnly ? !githubReadOnlyFiles.has(path) : quotaReview ? !quotaReviewFiles.has(path) : releaseFence ? !releaseFenceFiles.has(path) : safeStop ? !safeStopFiles.has(path) : ownerPrepare ? !ownerPrepareFiles.has(path) : sixCallD1 ? !sixCallD1Files.has(path) : sixCallController ? !sixCallFiles.has(path) : readOnlyHistoricalFix ? !readOnlyHistoricalPaths.has(path) : githubOwnerReviewFix ? !githubReviewPaths.has(path) : reviewedHistoricalPreflight ? !reviewedPreflightPaths.has(path) : shapeDiagnosticFix ? !shapeDiagnosticPaths.has(path) : unknownReviewFix ? !unknownReviewPaths.has(path) : modelErrorSafetyFix ? !modelErrorFixPaths.has(path) : prearmSafetyFix ? !prearmFixPaths.has(path) : watchdogShadowFix ? !watchdogShadowFixPaths.has(path) : liveEvidence ? !liveEvidencePaths.has(path) : independentWatchdog ? !watchdogFiles.has(path) : restoreExecutor ? !restoreExecutorFiles.has(path) : autoOffGuard ? !autoOffFiles.has(path) : smokeFix ? !smokeFiles.has(path) : safetyFix
    ? !safetyFixPaths.has(path)
    : (path!=='.github/workflows/swarm-offline-tests.yml'&&
       !path.startsWith('swarm/')&&!extra.has(path)));
  if(illegal.length)throw Error('Protected production path touched: '+illegal.join(', '));
  process.stdout.write('ISOLATED_PR_PATHS_PASS '+paths.length+' changed files\n');
}
process.stdout.write('SWARM_OFFLINE_ISOLATION_PASS\n');
