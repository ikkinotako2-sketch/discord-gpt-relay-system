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
test('redeploy accepts only known signed Discord GPT-OSS health markers and preserves strict signature checks',()=>{
 const expected=['Discord GPT Relay gpt-oss pilot ready.','Discord GPT Relay gpt-oss command-center ready.'];
 const first=y.indexOf('- name: Verify existing Worker is healthy and requires signed Discord interactions');
 const last=y.indexOf('- name: Verify new secret NAMES only, never their values',first);
 assert.ok(first>=0&&last>first);
 const preflight=y.slice(first,last);
 const set=preflight.match(/const allowed=new Set\\(\\[([^\\]]+)\\]\\);/);
 assert.ok(set,'must explicitly allow both known markers in preflight');
 assert.deepEqual([...set[1].matchAll(/'([^']+)'/g)].map(m=>m[1]),expected);
 assert.match(preflight,/get\\.status!==200 \\|\\| !allowed\\.has\\(marker\\) \\|\\| post\\.status!==401/);
 assert.doesNotMatch(preflight,/(?:marker\\.includes|marker\\.startsWith|post\\.status!==200)/);
 const rollback=y.slice(y.indexOf('- name: Restore known GPT-OSS version'));
 assert.ok(rollback.includes("new Set(['"+expected.join("','")+"'])"),'rollback must recognize both known versions');
 assert.match(rollback,/\\.has\\(\\(await r\\.text\\(\\)\\)\\.trim\\(\\)\\)/);
 assert.match(y,/ids\\.at\\(-1\\)!==process\\.env\\.NEW_VERSION/,'must still verify correct version deployed');
});
test('only the two D1 SELECT steps use a separate D1 Read-only GitHub Secret',()=>{
 const secret='CLOUDFLARE_API_TOKEN: '+String.fromCharCode(36)+'{{ secrets.DISCORD_D1_READ_TOKEN }}';
 assert.equal(y.split(secret).length-1,2,'dedicated D1 secret must be used only in two isolated D1 steps');
 for(const title of [
   'Verify zero active jobs from production Discord-only D1 before upload',
   'Recheck production D1 zero active jobs immediately before promotion']){
   const i=y.indexOf('- name: '+title);
   assert.ok(i>=0,'missing scoped D1 SELECT step');
   const next=y.indexOf('      - name:',i+10);
   const block=y.slice(i,next<0?undefined:next);
   assert.ok(block.includes(secret),'D1 step must override Worker token');
   assert.match(block,/dedicated Discord D1 Read token missing/,'missing read token must block release');
 }
 const workerSecret='CLOUDFLARE_API_TOKEN: '+String.fromCharCode(36)+'{{ secrets.CLOUDFLARE_API_TOKEN }}';
 assert.equal(y.split(workerSecret).length-1,1,'Worker controls must retain existing Worker token');
});
test('no unrelated Cloudflare resources, code routes or deploys are changed',()=>{
 assert.match(y,/WORKER_NAME: steep-glitter-b5cddiscord-ai-relay-lab/);
 assert.match(y,/database_id = "d80b08a4-0ff7-4320-9575-0d3c55cf7aba"/);
 // Existing workflow's explanatory log may mention other projects; block only actionable cross-project commands.
 assert.doesNotMatch(y,/d1 migrations apply|d1 execute .*INSERT|wrangler deploy --config wrangler\\.plm|versions deploy .*project-love-machine/i);
});
