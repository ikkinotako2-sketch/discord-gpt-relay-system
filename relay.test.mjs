import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandoff, relayOnce } from './relay.mjs';

test('passes planner output as builder context', async () => {
  const calls = [];
  const result = await relayOnce({
    runId: 'r1', task: 'Create a greeting page',
    generate: async input => {
      calls.push(input);
      return input.role === 'planner' ? 'Use one HTML heading.' : `Built following: ${input.context}`;
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].context, 'Use one HTML heading.');
  assert.equal(result.handoff.role, 'builder');
  assert.equal(result.status, 'completed');
});
test('rejects invalid iteration bounds', () => {
  assert.throws(() => makeHandoff({ runId: 'x', task: 'a', planning: 'b', iteration: 4 }), RangeError);
  assert.throws(() => makeHandoff({ runId: 'x', task: 'a', planning: 'b', maxIterations: 9 }), RangeError);
});
test('rejects blank task', async () => {
  await assert.rejects(() => relayOnce({ runId: 'r2', task: ' ', generate: async () => 'x' }), TypeError);
});
test('never performs more than two model calls in first prototype', async () => {
  let count = 0;
  await relayOnce({ runId: 'r3', task: 'Example', generate: async () => { count++; return 'ok'; } });
  assert.equal(count, 2);
});
test('rejects invalid run identifier', () => {
  assert.throws(() => makeHandoff({ runId: '../invalid', task: 'a', planning: 'b' }), TypeError);
});
test('fails closed on empty model output', async () => {
  await assert.rejects(() => relayOnce({ runId: 'r4', task: 'a', generate: async () => '' }), TypeError);
});
