// Fail-closed build guard: this project may deploy ONLY its own Discord Worker/D1.
// Never include Project Love Machine, YouTube or unrelated Cloudflare resources.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const conf=readFileSync(new URL('../wrangler.command-center.toml',import.meta.url),'utf8');
const expected=[
  'name = "steep-glitter-b5cddiscord-ai-relay-lab"',
  'main = "worker-loop.mjs"',
  'database_name = "discord-relay-loop-state"',
  'database_id = "d80b08a4-0ff7-4320-9575-0d3c55cf7aba"',
  'binding = "LOOP_DB"',
  'binding = "AI"',
  'LOOP_AI_MODEL = "@cf/openai/gpt-oss-20b"',
  'DASHBOARD_ENABLED = "true"',
  'keep_vars = true',
  'crons = ["*/1 * * * *"]',
  '"DISCORD_OAUTH_CLIENT_SECRET"',
  '"DASHBOARD_COOKIE_KEY"',
  '"DISCORD_PUBLIC_KEY"',
  '"DISCORD_ALLOWED_USER_ID"',
];
for(const setting of expected)assert.ok(conf.split('\n').some(x=>x.trim()===setting||x.includes(setting)), 'Missing safe config setting: '+setting);
for(const forbidden of ['plm-serverless-sandbox-state','plm-serverless-sandbox-control','project-love-machine','youtube','TIKTOK','DISCORD_BOT_TOKEN =']){
  assert.ok(!conf.toLowerCase().includes(forbidden.toLowerCase()),'Unrelated project or token referenced in deploy config');
}
assert.equal((conf.match(/\[\[d1_databases\]\]/g)||[]).length,1,'Exactly one Discord-only D1 binding required');
assert.equal((conf.match(/^name\s*=/gm)||[]).length,1,'Exactly one Discord-only Worker allowed');
const wf=readFileSync(new URL('../.github/workflows/command-center-build.yml',import.meta.url),'utf8');
assert.ok(wf.includes('--dry-run') && wf.includes('--config wrangler.command-center.toml'),'Build must be compile-only');
assert.ok(!wf.includes('versions deploy')&&!wf.includes('triggers deploy'),'Build must not change production');
const release=readFileSync(new URL('../.github/workflows/command-center-guarded-release.yml',import.meta.url),'utf8');
const isManual=release.includes('  workflow_dispatch:')&&!release.includes('  push:');
const isOwnerApprovedOneShot=release.includes("      - 'preflight/command-center-owner-approved.once'") &&
  release.includes("github.event.head_commit.message == 'Run approved isolated Command Center release once'") &&
  release.includes("test \"$(cat preflight/command-center-owner-approved.once)\" = 'APPROVED_ONCE:PRIVATE_DASHBOARD:DISCORD_ONLY'") &&
  release.includes("test \"$GITHUB_REPOSITORY\" = 'ikkinotako2-sketch/discord-gpt-relay-system'");
assert.ok((isManual||isOwnerApprovedOneShot)&&!release.includes('  schedule:'),
  'Production release needs owner manual approval or a strictly pinned one-shot marker');
assert.ok(release.includes('WORKER_NAME: steep-glitter-b5cddiscord-ai-relay-lab')&&
  release.includes('database_id = "d80b08a4-0ff7-4320-9575-0d3c55cf7aba"'),
  'Production release must be pinned to exact Discord resources');
assert.ok(release.includes('OLD_VERSION=')&&release.includes('Restore known GPT-OSS version'),
  'Capture current production version and preserve rollback');
// Exactly two read-only remote COUNT(*) checks are allowed. No D1 mutation or migrations.
const safeRead = 'd1 execute discord-relay-loop-state --remote --config wrangler.command-center.toml --json --command "SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE status IN (\'queued\',\'claimed\') OR active_slot = 1;"';
const count=(release.match(/d1 execute /g)||[]).length;
assert.equal(count,2,'Exactly two D1 read-only checks are required');
assert.equal(release.split(safeRead).length-1,2,'Only exact Discord-only active-job SELECT checks may run');
assert.equal(release.split('node command-center/release-d1-guard.mjs /tmp/d1-before-').length-1,2,
  'Every D1 query must have strict fail-closed response validation');
assert.ok(!release.includes('triggers deploy')&&!release.includes('d1 migrations'),
  'No D1 migration or Cron deployment');
assert.ok(!/d1 execute .*--file|d1 (?:delete|import|create|migrations)/i.test(release),
  'No D1 writes or migrations permitted in dashboard release');
console.log('ISOLATION_GUARD_PASS: Discord-only Worker/D1. No YouTube/PLM targets. Offline build only.');
