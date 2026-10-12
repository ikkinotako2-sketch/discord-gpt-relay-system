import test from 'node:test';
import assert from 'node:assert/strict';
import {loopStageMessages,evaluateLoopFinalOutput,generateLoopStageWithWorkersAI,resolveLoopModel,extractLoopFinalText,GPT_OSS_MODEL} from './loop-quality.mjs';

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

test('existing production Llama remains the default; GPT-OSS requires explicit exact opt-in',()=>{
  assert.equal(resolveLoopModel({}),'@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(resolveLoopModel({LOOP_AI_MODEL:''}),'@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(resolveLoopModel({LOOP_AI_MODEL:GPT_OSS_MODEL}),GPT_OSS_MODEL);
  assert.throws(()=>resolveLoopModel({LOOP_AI_MODEL:'gpt-4o'}),/Unsupported LOOP_AI_MODEL/);
  assert.throws(()=>resolveLoopModel({LOOP_AI_MODEL:'@cf/openai/gpt-oss-120b'}),/Unsupported LOOP_AI_MODEL/);
});

test('GPT-OSS uses Cloudflare binding, low reasoning and bounded tokens',async()=>{
  const calls=[];
  const env={LOOP_AI_MODEL:GPT_OSS_MODEL,AI:{run:async(model,request)=>{
    calls.push({model,request});
    return {response:'こんにちは！よろしくお願いします。'};
  }}};
  const result=await generateLoopStageWithWorkersAI(env,{
    role:'builder',task:'短い挨拶文を改善して',context:'先ほどの短い挨拶案'
  });
  assert.match(result,/こんにちは/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].model,'@cf/openai/gpt-oss-20b');
  assert.equal(calls[0].request.reasoning_effort,'low');
  assert.equal(calls[0].request.temperature,0.2);
  assert.equal(calls[0].request.max_tokens,420);
  assert.equal(JSON.parse(calls[0].request.messages[1].content).original_task,'短い挨拶文を改善して');
});

test('GPT-OSS prompt stage has lower generation ceiling and does not expose raw reasoning',async()=>{
  const calls=[];
  const env={LOOP_AI_MODEL:GPT_OSS_MODEL,AI:{run:async(model,request)=>{
    calls.push(request);
    return {choices:[{message:{content:'丁寧な挨拶文を作る。',reasoning:'internal'}}]};
  }}};
  const r=await generateLoopStageWithWorkersAI(env,{
    role:'planner',task:'挨拶文の計画',context:''
  });
  assert.equal(r,'丁寧な挨拶文を作る。');
  assert.equal(calls[0].max_tokens,300);
  assert.equal(calls.length,1);
});

test('read only final message from supported provider outputs',()=>{
  assert.equal(extractLoopFinalText({response:'  おはよう  '}),'おはよう');
  assert.equal(extractLoopFinalText({choices:[{message:{content:'こんにちは'}}]}),'こんにちは');
  const obj={output:[{type:'reasoning',content:[{type:'output_text',text:'PRIVATE REASONING'}]},
    {type:'message',content:[{type:'output_text',text:'こんにちは！'}]}]};
  assert.equal(extractLoopFinalText(obj),'こんにちは！');
  assert.throws(()=>extractLoopFinalText({output:[{type:'reasoning',content:[{type:'output_text',text:'PRIVATE'}]}]}),/No final message/);
  assert.throws(()=>extractLoopFinalText({response:''}),/No final message/);
});

test('unknown configured model causes zero inference calls',async()=>{
  let n=0;
  await assert.rejects(()=>generateLoopStageWithWorkersAI({
    LOOP_AI_MODEL:'@cf/not-a-supported-model',
    AI:{run:async()=>{n++;return {response:'unwanted'}}},
  },{role:'planner',task:'Valid'}),/Unsupported LOOP_AI_MODEL/);
  assert.equal(n,0);
});

test('too much generated text fails before persisting or retrying',async()=>{
  let calls=0;
  await assert.rejects(()=>generateLoopStageWithWorkersAI({
    LOOP_AI_MODEL:GPT_OSS_MODEL,
    AI:{run:async()=>{calls++;return {response:'あ'.repeat(3001)}}},
  },{role:'builder',task:'短い挨拶文を改善して'}),/exceeds persisted output/);
  assert.equal(calls,1);
});
