import test from 'node:test';
import assert from 'node:assert/strict';
import {loopStageMessages,evaluateLoopFinalOutput,generateLoopStageWithWorkersAI} from './loop-quality.mjs';

test('every loop stage includes exact original instruction even if previous draft drifts',()=>{
  for(const role of ['planner','builder']){
    const messages=loopStageMessages({
      role,task:'短い挨拶文を改善して',
      context:'タイトル: 急いでいるときの行動'
    });
    assert.equal(messages.length,2);
    const prompt=JSON.parse(messages[1].content);
    assert.equal(prompt.original_task,'短い挨拶文を改善して');
    assert.match(prompt.previous_stage_untrusted_reference,/急いでいる/);
    assert.match(messages[0].content,/元の依頼/);
    assert.match(messages[0].content,/挨拶文/);
  }
});

test('greeting task rejects screenshot-like unrelated final output',()=>{
  const task='短い挨拶文を改善して';
  const offTopic='タイトル：急いでいるときの安全な行動\nタスク：落ち着いて周囲を確認する。';
  assert.deepEqual(evaluateLoopFinalOutput(task,offTopic),{ok:false,reason:'TASK_MISMATCH'});
  assert.deepEqual(evaluateLoopFinalOutput(task,'こんにちは！今日もよろしくお願いします。'),{ok:true,reason:null});
  assert.deepEqual(evaluateLoopFinalOutput(task,'おはようございます。本日もよろしくお願いします。'),{ok:true,reason:null});
});

test('word greeting in abstract commentary does not qualify as a usable greeting',()=>{
  assert.equal(evaluateLoopFinalOutput('挨拶文を作って','これは挨拶についての一般的な説明です。').ok,false);
});

test('non-greeting tasks remain available without an overly broad keyword veto',()=>{
  assert.deepEqual(evaluateLoopFinalOutput('安全なWebアプリの仕様を整理','認証と監査を確認する。'),{ok:true,reason:null});
});

test('loop model calls carry stable task and no additional model validation call',async()=>{
  const calls=[];
  const env={AI:{run:async(model,input)=>{
    calls.push({model,input});return {response:'こんにちは！よろしくお願いします。'};
  }}};
  const r=await generateLoopStageWithWorkersAI(env,{role:'builder',task:'短い挨拶文を改善して',context:'別の話題の原稿'});
  assert.match(r,/こんにちは/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].input.max_tokens,320);
  const prompt=JSON.parse(calls[0].input.messages[1].content);
  assert.equal(prompt.original_task,'短い挨拶文を改善して');
  assert.equal(prompt.previous_stage_untrusted_reference,'別の話題の原稿');
});

test('invalid role is rejected before inference',async()=>{
  let called=0;
  await assert.rejects(()=>generateLoopStageWithWorkersAI({AI:{run:async()=>{called++;return {response:'ok'}}}},{role:'auditor',task:'test'}),TypeError);
  assert.equal(called,0);
});
