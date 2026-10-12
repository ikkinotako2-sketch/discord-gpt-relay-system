import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const y=readFileSync(new URL('../.github/workflows/command-center-guarded-release.yml',import.meta.url),'utf8');
const QUERY="SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE status IN ('queued','claimed') OR active_slot = 1;";
const CHECK="d1 execute discord-relay-loop-state --remote --config wrangler.command-center.toml --json --command";
test('production release is still an explicitly approved single main-branch push',()=>{
 assert.match(y,/branches: \[main\]/);
 assert.match(y,/preflight\/command-center-owner-approved\.once/);
 assert.match(y,/github\.event\.head_commit\.message == 'Run approved isolated Command Center release once'/);
 assert.doesNotMatch(y,/\n\s*workflow_dispatch:/);
});
test('live remote D1 zero-job gate runs before upload and immediately before promotion',()=>{
 const lines=y.split('\n');
 const checks=lines.flatMap((s,i)=>s.includes(CHECK)?[i]:[]);
 assert.equal(checks.length,2,'must run exactly two read-only D1 checks');
 assert.equal(y.split(QUERY).length-1,2);
 const upload=lines.findIndex(x=>x.includes('versions upload --config wrangler.command-center.toml'));
 const promotion=lines.findIndex(x=>x.includes('versions deploy "$NEW_VERSION@100%"'));
 assert.ok(checks[0]>0 && checks[0]<upload,'initial check before inactive upload');
 assert.ok(checks[1]>upload && checks[1]<promotion,'final check immediately before live promotion');
 const validator=lines.filter(x=>x.includes('node command-center/release-d1-guard.mjs '));
 assert.equal(validator.length,2,'must validate each D1 response or fail closed');
 const between=lines.slice(checks[1],promotion).join('\n');
 assert.doesNotMatch(between,/versions upload|deploy --config|migrations apply|d1 execute .*--file/);
});
test('no unrelated Cloudflare resources, code routes or deploys are changed',()=>{
 assert.match(y,/WORKER_NAME: steep-glitter-b5cddiscord-ai-relay-lab/);
 assert.match(y,/database_id = "d80b08a4-0ff7-4320-9575-0d3c55cf7aba"/);
 // Existing workflow's explanatory log may mention other projects; block only actionable cross-project commands.
 assert.doesNotMatch(y,/d1 migrations apply|d1 execute .*INSERT|wrangler deploy --config wrangler\\.plm|versions deploy .*project-love-machine/i);
});
