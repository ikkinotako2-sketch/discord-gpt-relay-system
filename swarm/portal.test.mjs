import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSwarmRoute,renderPrivateSwarmPage} from './portal.mjs';
import {createDashboardSession,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
const PAGE_URL=COMMAND_CENTER_ORIGIN+'/command-center/swarm/';
const OWNER='123456789012345678';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(text){const stmt=sql.prepare(text);return{bind(...args){return{
  first:async()=>stmt.get(...args)||null,
  all:async()=>({results:stmt.all(...args)}),
  run:async()=>({meta:{changes:stmt.run(...args).changes}})
 }}}}};
 const env={LOOP_DB:db,DASHBOARD_ENABLED:'true',SWARM_API_ENABLED:'true',
 DISCORD_ALLOWED_USER_ID:OWNER,DISCORD_OAUTH_CLIENT_SECRET:'fake-local-oauth-secret-123456',
 DASHBOARD_COOKIE_KEY:'fake_local_test_session_key_1234567890'};
 return {db,env};
}
test('portal is disabled without explicit swarm API flag',async()=>{
 const {env}=fixture();
 assert.equal((await handleSwarmRoute(new Request(PAGE_URL),{...env,SWARM_API_ENABLED:'false'})).status,503);
});
test('portal requires owner Discord OAuth session and redirects anonymous visitor',async()=>{
 const {env}=fixture();
 const result=await handleSwarmRoute(new Request(PAGE_URL),env);
 assert.equal(result.status,302);
 assert.equal(result.headers.get('location'),'/command-center/login');
});
test('owner portal is nonce-free hashed CSP with script and styles',async()=>{
 const {env}=fixture(),token=await createDashboardSession(OWNER,env);
 const response=await handleSwarmRoute(new Request(PAGE_URL,{headers:{Cookie:'dc_session='+token}}),env);
 assert.equal(response.status,200);
 const csp=response.headers.get('content-security-policy');
 assert.match(csp,/script-src 'sha256-/);
 assert.match(csp,/style-src 'sha256-/);
 assert.match(csp,/connect-src 'self'/);
 assert.match(csp,/frame-ancestors 'none'/);
 assert.doesNotMatch(csp,/unsafe-inline/);
 const html=await response.text();
 assert.match(html,/6-ROLE AI ORCHESTRATION/);
 assert.match(html,/owner/i);
});
test('portal only accepts exact same-origin routes, no arbitrary prefix',async()=>{
 const {env}=fixture();
 assert.equal((await handleSwarmRoute(new Request('https://example.invalid/command-center/swarm/'),env)).status,404);
 assert.equal((await handleSwarmRoute(new Request(COMMAND_CENTER_ORIGIN+'/command-center/swarm-bad'),env)).status,404);
 assert.equal((await handleSwarmRoute(new Request(URL,{method:'POST'}),env)).status,405);
});
test('page renderer never sets public-cache policy',async()=>{
 const response=await renderPrivateSwarmPage();
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-frame-options'),'DENY');
});
