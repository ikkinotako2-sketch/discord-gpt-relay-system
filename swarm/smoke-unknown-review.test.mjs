import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHistoricalUnknown} from './smoke-unknown-review.mjs';
const created=Date.UTC(2026,9,24,10,45),updated=created+50000;
const row=()=>({status:'unknown',calls_used:1,cycles:1,active_slot:null,stop_requested:0,
 last_error:'MODEL_OUTCOME_UNKNOWN',created_at:created,updated_at:updated,history_length:2,checkpoint_length:0});
const review=()=>({kind:'OWNER_REVIEWED_UNCERTAIN_NO_RETRY',reviewedAt:Date.UTC(2026,9,24,11),
 createdAt:created,updatedAt:updated,callsUsed:1,error:'MODEL_OUTCOME_UNKNOWN',
 ownerApprovalReference:'https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-123'});
const good=()=>({snapshot:{legacyActive:0,swarmActive:0,pendingStop:0,unknownJobs:1},
 rows:[row()],review:review(),nowMs:Date.UTC(2026,9,25,1),dailyReserved:0,dailyCap:6});
const testBlocked=(change,reason)=>{
 const i=good();change(i);const r=assessHistoricalUnknown(i);
 assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesLiveActions,false);
 assert.ok(r.blockers.includes(reason),JSON.stringify(r));
};
test('explicit historical review is still NEVER live permission',()=>{
 const r=assessHistoricalUnknown(good());
 assert.equal(r.authorizesLiveActions,false);
 assert.equal(r.status,'REVIEWED_HISTORICAL_UNKNOWN_NEEDS_ALL_LIVE_PREFLIGHTS');
});
test('owner review absent rejects',()=>testBlocked(x=>x.review=null,'EXPLICIT_OWNER_AUDIT_REVIEW_REQUIRED'));
test('same UTC day rejects',()=>testBlocked(x=>x.nowMs=Date.UTC(2026,9,24,22),'SAME_UTC_DAY_LOCAL_CAP_NOT_REFRESHED'));
test('other unknown jobs reject',()=>testBlocked(x=>x.snapshot.unknownJobs=2,'EXACTLY_ONE_HISTORICAL_UNKNOWN_REQUIRED'));
test('active job rejects',()=>testBlocked(x=>x.snapshot.swarmActive=1,'ACTIVE_JOB_OR_STOP_PENDING'));
test('changed unknown row rejects',()=>testBlocked(x=>x.rows[0].history_length=40,'UNKNOWN_ROW_CHANGED_OR_UNVERIFIED'));
test('changed timestamp invalidates prior review',()=>testBlocked(x=>x.rows[0].updated_at++,'EXPLICIT_OWNER_AUDIT_REVIEW_REQUIRED'));
test('same-day budget reservation rejects',()=>testBlocked(x=>x.dailyReserved=1,'NEW_DAY_SIX_CALL_BUDGET_NOT_ZERO'));
test('non-six cap rejects',()=>testBlocked(x=>x.dailyCap=18,'NEW_DAY_SIX_CALL_BUDGET_NOT_ZERO'));
test('unrelated repo approval rejects',()=>testBlocked(x=>x.review.ownerApprovalReference='https://github.com/else/other/issues/14','EXPLICIT_OWNER_AUDIT_REVIEW_REQUIRED'));
