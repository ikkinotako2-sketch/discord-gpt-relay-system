import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRelay, validDiscordRequest, generateWithWorkersAI } from './worker-relay.mjs';

test('two real AI binding invocations transmit plan to builder', async () => {
  const calls = [];
  const env = { AI: { run: async (_model, opts) => {
    calls.push(opts);
    return { response: calls.length === 1 ? 'ステップ1を行う' : '実装案：ステップ1を行う' };
  } } };
  const response = await handleRelay({ id: '123', data: { options: [{ name: 'task', value: '安全なWebアプリを計画' }] } }, env);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[1].content, /ステップ1を行う/);
  assert.match(response, /AI B/);
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
