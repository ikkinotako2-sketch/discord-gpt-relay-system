import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSwarmHandoff} from './handoff.mjs';
test('handoff captures confirmed roles, checkpoint and next step only',()=>{
 const src={schema:'discord-swarm.v1',jobs:[{
   id:'abc',task:'safe task',status:'queued',callsUsed:2,callsMax:6,
   stage:{label:'開発AI'},lastCheckpoint:'research done',history:[
    {stage:{label:'司令塔AI',cycle:1},output:'plan'},
    {stage:{label:'調査AI',cycle:1},output:'research done'}]}]};
 const p=buildSwarmHandoff(src,{now:Date.UTC(2026,9,12)});
 assert.equal(p.schema,'discord-swarm.handoff.v1');
 assert.equal(p.nextRole,'開発AI');
 assert.equal(p.history.length,2);
 assert.match(p.markdown,/safe task/);
 assert.match(p.markdown,/調査AI/);
 assert.doesNotMatch(p.markdown,/automatically creates consumer chats/i);
});
test('unknown model outcomes demand manual review, never blind retry',()=>{
 const x=buildSwarmHandoff({schema:'discord-swarm.v1',jobs:[{
   id:'j',status:'unknown',callsUsed:1,callsMax:6,history:[],lastCheckpoint:'last known'
 }]});
 assert.equal(x.needsManualReview,true);
 assert.equal(x.nextRole,null);
 assert.match(x.markdown,/重複したAI処理を自動実行せず/);
});
test('no jobs yields honest idle packet without fabricated work',()=>{
 const x=buildSwarmHandoff({schema:'discord-swarm.v1',jobs:[]});
 assert.equal(x.status,'idle');
 assert.equal(x.stepsConfirmed,0);
 assert.equal(x.task,null);
});
test('invalid snapshots and injected control characters cannot become document structure',()=>{
 assert.throws(()=>buildSwarmHandoff({jobs:[]}),TypeError);
 const x=buildSwarmHandoff({schema:'discord-swarm.v1',jobs:[{
   id:'r',task:'abc\u0000def',status:'stopped',callsUsed:0,callsMax:6,history:[]
 }]});
 assert.doesNotMatch(x.markdown,/\u0000/);
});
