import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkersAiBoundedLoop } from './loop-worker.mjs';

test('Workers AI adapter carries draft into second planning cycle', async () => {
  const calls = [];
  const env = { AI: { run: async (model, payload) => {
    assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fp8');
    calls.push(payload);
    return { response: 'message-' + calls.length };
  } } };
  const result = await runWorkersAiBoundedLoop({
    env, runId: 'd1234', task: 'Write a simple project proposal', maxRounds: 2,
  });
  assert.equal(result.status, 'stopped_at_round_limit');
  assert.equal(result.calls_used, 4);
  assert.equal(result.rounds.length, 2);
  assert.equal(calls[0].messages[1].content, 'Write a simple project proposal');
  assert.match(calls[1].messages[1].content, /message-1/);
  assert.match(calls[2].messages[1].content, /previous_builder_output_reference/);
  assert.match(calls[2].messages[1].content, /message-2/);
  assert.match(calls[3].messages[1].content, /message-3/);
  assert.deepEqual(calls.map(x=>x.max_tokens), [260,320,260,320]);
});

test('Workers AI adapter does not retry failed provider calls', async () => {
  let calls = 0;
  const env = { AI: { run: async () => { calls++; throw Error('AI unavailable'); } } };
  await assert.rejects(() => runWorkersAiBoundedLoop({
    env, runId:'err1', task:'Safe experiment',
  }), /AI unavailable/);
  assert.equal(calls, 1);
});

test('Workers AI adapter respects immediate stop', async () => {
  let calls = 0;
  const env = { AI: { run: async () => { calls++; return {response: 'ok'}; } } };
  const result = await runWorkersAiBoundedLoop({
    env, runId:'stopped1', task:'Safe experiment', shouldStop: () => true,
  });
  assert.equal(result.status, 'stopped_by_request');
  assert.equal(calls, 0);
});

test('Workers AI adapter requires a binding', async () => {
  await assert.rejects(() => runWorkersAiBoundedLoop({
    env: {}, runId:'err2', task:'Safe experiment',
  }), /AI binding unavailable/);
});
