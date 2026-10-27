// Pinned SQL text SHA-256 for OFFLINE-staged six-call D1 migration objects.
// Digest source: sqlite_master.sql after applying the REVIEW-ONLY SQL proposals
// with Node 22 SQLite. Never accept caller-provided expected SQL fingerprints.
// Matching DDL does NOT authorize D1 migration, inference or Worker deployment.
export const D1_SMOKE_EXPECTED_DDL_SHA256=Object.freeze({
 swarm_smoke_control_runs:'843b108fb9a827d0f75625d84295c46c96f87b00620754444a3068dcba2b2215',
 swarm_smoke_control_claims:'20f5162ef21f8cbade68c328375297ce0edeb4a5244bc0bc00f8e7b19b6dabbf',
 swarm_smoke_control_one_open:'16308689b0842204064aa6a0bdf3863223417d7c277de48202d19a94b9910881',
 swarm_smoke_control_one_pending_or_open:'26a70fd0160860581e806b74a8045e51863985c6262c998e223153b94b90fd12',
 swarm_smoke_control_claim_atomic:'0712349e3391b0605907bed80038e34befdfb536081131d8a9aef9432b13103e',
 swarm_smoke_control_settle_atomic:'d3ce0ba602d0e4c6e5e96cc66087c522b2c6bdc607c4bce0a2e645dce704c7f3',
 swarm_smoke_control_outputs:'a2f9af41d2b3fef50a6bac59029c66a26b2e63fa560a1952036ba6cfc0868bf4',
 swarm_smoke_control_owner_tasks:'57708a5b4bce2e2a2858afa26cf9fc9dbb61ecd5a7f3f7b66fccde128af37a2f',
 swarm_smoke_control_owner_task_scope:'b22e41050dd3b9b44a56f765ca5697db35251fb9057871702b7e451fcabd32ab',
 swarm_smoke_control_owner_task_no_update:'bd41faebeda57479c337a084e603498fac778cfe2af05f24c4add56ffc003b23',
 swarm_smoke_control_owner_task_no_delete:'ce14bad5ba402008cb73480220d7a6d9e61e95b142123f581191d29c29bf1d4a'
});
const SQL_OBJECT_TYPE=Object.freeze({
 swarm_smoke_control_runs:'table',swarm_smoke_control_claims:'table',
 swarm_smoke_control_one_open:'index',
 swarm_smoke_control_one_pending_or_open:'index',
 swarm_smoke_control_claim_atomic:'trigger',
 swarm_smoke_control_settle_atomic:'trigger',
 swarm_smoke_control_outputs:'table',
 swarm_smoke_control_owner_tasks:'table',
 swarm_smoke_control_owner_task_scope:'trigger',
 swarm_smoke_control_owner_task_no_update:'trigger',
 swarm_smoke_control_owner_task_no_delete:'trigger'
});
const HEX=/^[a-f0-9]{64}$/;
async function sha256(text){
 // Only local, fixed-object SQL text from sqlite_master; never secrets or jobs.
 const bytes=new TextEncoder().encode(text);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
/** Attest byte-for-byte SQLite DDL as stored in sqlite_master.sql.
 * A same-name but modified trigger, missing UNIQUE clause, wrong table CHECK,
 * or extra statement will be rejected. No contents/digests returned to caller.
 */
export async function attestSixCallD1SqlDefinitions(rows){
 if(!Array.isArray(rows)||rows.length!==Object.keys(SQL_OBJECT_TYPE).length)
  return false;
 const seen=new Set();
 for(const r of rows){
  if(!r||!Object.hasOwn(SQL_OBJECT_TYPE,r.name)||seen.has(r.name)||
     r.type!==SQL_OBJECT_TYPE[r.name]||typeof r.sql!=='string'||
     !r.sql.startsWith('CREATE ')||r.sql.length>10000||
     !HEX.test(D1_SMOKE_EXPECTED_DDL_SHA256[r.name]))
   return false;
  seen.add(r.name);
  if(await sha256(r.sql)!==D1_SMOKE_EXPECTED_DDL_SHA256[r.name])return false;
 }
 return seen.size===Object.keys(SQL_OBJECT_TYPE).length;
}
