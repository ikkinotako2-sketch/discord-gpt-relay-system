import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedLoop } from './loop-core.mjs';

test('automatically hands builder output back into next planner', async () => {
  const calls = [];
  const result = await runBoundedLoop({
    runId: 'loop1',
    task: 'Write a small website',
    generate: async args => {
      calls.push(args);
      if (args.role === 'planner') return `Plan ${args.round} from: ${args.context || 'initial'}`;
      return `Built round ${args.round} from: ${args.context}`;
    },
  });
  assert.equal(result.status, 'stopped_at_round_limit');
  assert.equal(result.rounds.length, 2);
  assert.equal(result.calls_used, 4);
  assert.deepEqual(calls.map(x => [x.role, x.round]), [
    ['planner', 1], ['builder', 1], ['planner', 2], ['builder', 2],
  ]);
  assert.equal(calls[1].context, result.rounds[0].plan);
  assert.equal(calls[2].context, result.rounds[0].artifact);
  assert.equal(calls[3].context, result.rounds[1].plan);
  assert.equal(result.final_artifact, result.rounds[1].artifact);
});

test('single round uses exactly two calls', async () => {
  let calls = 0;
  const result = await runBoundedLoop({
    runId: 'loop2', task: 'Simple task', maxRounds: 1,
    generate: async () => { calls++; return 'output'; },
  });
  assert.equal(calls, 2);
  assert.equal(result.rounds.length, 1);
});

test('blocks invalid maxRounds before model is called', async () => {
  let calls = 0;
  for (const maxRounds of [0, 3, 12, 1.5, '2']) {
    await assert.rejects(() => runBoundedLoop({
      runId: 'loop3', task: 'Valid', maxRounds,
      generate: async () => { calls++; return 'ok'; },
    }), RangeError);
  }
  assert.equal(calls, 0);
});

test('cooperative stop between rounds prevents any new model calls', async () => {
  let calls = 0;
  const result = await runBoundedLoop({
    runId: 'loop4', task: 'Stop after first round',
    generate: async () => { calls++; return 'answer'; },
    shouldStop: ({ roundsCompleted }) => roundsCompleted >= 1,
  });
  assert.equal(result.status, 'stopped_by_request');
  assert.equal(result.rounds.length, 1);
  assert.equal(result.calls_used, 2);
  assert.equal(calls, 2);
});

test('cooperative stop between planner and builder prevents builder call', async () => {
  const seen = [];
  const result = await runBoundedLoop({
    runId: 'loop5', task: 'Emergency stop',
    generate: async input => { seen.push(input.role); return 'plan'; },
    shouldStop: ({ callsUsed }) => callsUsed >= 1,
  });
  assert.deepEqual(seen, ['planner']);
  assert.equal(result.calls_used, 1);
  assert.equal(result.status, 'stopped_by_request');
});

test('stops on invalid model output without retry', async () => {
  let calls = 0;
  await assert.rejects(() => runBoundedLoop({
    runId: 'loop6', task: 'Valid task',
    generate: async () => { calls++; return ''; },
  }), TypeError);
  assert.equal(calls, 1);
});

test('stops on model failure without retry', async () => {
  let calls = 0;
  await assert.rejects(() => runBoundedLoop({
    runId: 'loop7', task: 'Valid task',
    generate: async () => { calls++; throw Error('Provider unavailable'); },
  }), /Provider unavailable/);
  assert.equal(calls, 1);
});

test('rejects invalid task and ID before model invocation', async () => {
  let calls = 0;
  for (const args of [{ runId: '../oops', task:'good' }, { runId:'r8', task:'   ' }, { runId:'r8', task:'x'.repeat(1001) }]) {
    await assert.rejects(() => runBoundedLoop({
      ...args, generate: async () => { calls++; return 'ok'; },
    }), TypeError);
  }
  assert.equal(calls, 0);
});

test('rejects overly large generated plans without running builder', async () => {
  let calls = 0;
  await assert.rejects(() => runBoundedLoop({
    runId: 'loop9', task: 'Do task',
    generate: async () => { calls++; return 'z'.repeat(3001); },
  }), TypeError);
  assert.equal(calls, 1);
});

test('stop request before round one causes zero calls', async () => {
  let calls = 0;
  const result = await runBoundedLoop({
    runId: 'loop10', task: 'No calls',
    shouldStop: () => true,
    generate: async () => { calls++; return 'unexpected'; },
  });
  assert.equal(calls, 0);
  assert.equal(result.calls_used, 0);
  assert.equal(result.status, 'stopped_by_request');
});
