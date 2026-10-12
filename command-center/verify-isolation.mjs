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
console.log('ISOLATION_GUARD_PASS: Discord-only Worker/D1. No YouTube/PLM targets. Offline build only.');
