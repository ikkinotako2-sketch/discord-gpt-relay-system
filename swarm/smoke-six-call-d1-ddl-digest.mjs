// Pinned SQL text SHA-256 for OFFLINE-staged six-call D1 migration objects.
// Digest source: sqlite_master.sql after applying the REVIEW-ONLY SQL proposals
// with Node 22 SQLite. Never accept caller-provided expected SQL fingerprints.
// Matching DDL does NOT authorize D1 migration, inference or Worker deployment.
export const D1_SMOKE_EXPECTED_DDL_SHA256=Object.freeze({
 swarm_smoke_control_runs:'__HASH_PENDING__',
 swarm_smoke_control_claims:'__HASH_PENDING__',
 swarm_smoke_control_one_open:'__HASH_PENDING__',
 swarm_smoke_control_one_pending_or_open:'__HASH_PENDING__',
 swarm_smoke_control_claim_atomic:'__HASH_PENDING__',
 swarm_smoke_control_settle_atomic:'__HASH_PENDING__'
});
const SQL_OBJECT_TYPE=Object.freeze({
 swarm_smoke_control_runs:'table',swarm_smoke_control_claims:'table',
 swarm_smoke_control_one_open:'index',
 swarm_smoke_control_one_pending_or_open:'index',
 swarm_smoke_control_claim_atomic:'trigger',
 swarm_smoke_control_settle_atomic:'trigger'
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
