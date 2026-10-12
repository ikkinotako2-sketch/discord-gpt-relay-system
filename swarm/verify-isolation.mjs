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
  const priorIntegration=[stackedBase,'main'].includes(base)&&process.env.GITHUB_HEAD_REF===stackedHead;
  if(!safetyFix&&!priorIntegration)
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
  const illegal=paths.filter(path=>safetyFix
    ? !safetyFixPaths.has(path)
    : (path!=='.github/workflows/swarm-offline-tests.yml'&&
       !path.startsWith('swarm/')&&!extra.has(path)));
  if(illegal.length)throw Error('Protected production path touched: '+illegal.join(', '));
  process.stdout.write('ISOLATED_PR_PATHS_PASS '+paths.length+' changed files\n');
}
process.stdout.write('SWARM_OFFLINE_ISOLATION_PASS\n');
