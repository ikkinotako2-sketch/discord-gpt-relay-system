import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRelay, handleAsk, validDiscordRequest, generateWithWorkersAI } from './worker-relay.mjs';

test('two real AI binding invocations transmit plan to builder', async () => {
  const calls = [];
  const env = { AI: { run: async (_model, opts) => {
    calls.push(opts);
    return { response: calls.length === 1 ? 'ステップ1を行う' : '実装案：ステップ1を行う' };
  } } };
  const response = await handleRelay({ id: '123', data: { options: [{ name: 'task', value: '安全なWebアプリを計画' }] } }, env);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[1].content, /ステップ1を行う/);
  assert.equal(calls[0].max_tokens, 260);
  assert.equal(calls[1].max_tokens, 320);
  assert.match(response, /AI B/);
  assert.match(response, /AI処理：約[0-9.]+秒/);
});
test('rejects empty task without running model', async () => {
  const text = await handleRelay({ id: '123', data: { options: [{name:'task',value:' '}]} }, {});
  assert.match(text, /1〜1000文字/);
});
test('signature rejects missing headers', async () => {
  assert.equal(await validDiscordRequest(new Request('https://test.invalid/', {method:'POST'}), '{}', '00'.repeat(32)), false);
});
test('missing AI binding stops safely', async () => {
  await assert.rejects(() => generateWithWorkersAI({}, { role:'planner', task:'test', context:'' }), /AI binding/);
});

test('ask replies with one AI call and preserves question', async () => {
  const calls = [];
  const response = await handleAsk({ data: { options: [{ name: 'question', value: 'こんにちは' }] } }, {
    AI: { run: async (_model, options) => {
      calls.push(options);
      return { response: 'こんにちは！' };
    } },
  });
  assert.equal(response, 'こんにちは！');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[1].content, 'こんにちは');
  assert.equal(calls[0].max_tokens, 240);
});
test('ask rejects blank question without model call', async () => {
  const response = await handleAsk({data:{options:[{name:'question',value:''}]}}, {});
  assert.match(response, /1〜1000文字/);
});
test('ask fails closed on invalid AI response', async () => {
  await assert.rejects(() => handleAsk({data:{options:[{name:'question',value:'hello'}]}}, {
    AI: {run: async()=>({response:null})},
  }), /Invalid model response/);
});

test('latency version has an unambiguous public health identity', async () => {
  const r = await worker.fetch(new Request('https://example.invalid/', {method:'GET'}), {}, {});
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'Discord GPT Relay ready (latency-v1).');
});
