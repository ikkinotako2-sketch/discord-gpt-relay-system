import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopJob, nextLoopStep, completeLoopStep, requestLoopStop } from './loop-state.mjs';

test('durable state performs four sequential calls and automatically re-plans', () => {
  let job = createLoopJob({runId:'durable1',task:'Build sample site'});
  const visited = [];
  for (let i=0;i<4;i++) {
    const step = nextLoopStep(job);
    visited.push([step.role, step.round, step.context]);
    job = completeLoopStep(job, {...step, output:'result-' + (i+1)});
  }
  assert.deepEqual(visited.map(x=>x.slice(0,2)), [
    ['planner',1], ['builder',1], ['planner',2], ['builder',2],
  ]);
  assert.equal(visited[2][2], 'result-2');
  assert.equal(job.calls_used,4);
  assert.equal(job.revision,4);
  assert.equal(job.status,'completed');
  assert.equal(nextLoopStep(job),null);
});

test('stale revision and role mismatch block duplicate completion', () => {
  const job = createLoopJob({runId:'durable2',task:'Simple'});
  const step = nextLoopStep(job);
  const advanced = completeLoopStep(job,{...step,output:'plan'});
  assert.throws(()=>completeLoopStep(advanced,{...step,output:'plan'}),/Stale or mismatched step/);
  assert.throws(()=>completeLoopStep(advanced,{...nextLoopStep(advanced),role:'planner',output:'x'}),/Stale or mismatched step/);
});

test('STOP invalidates an in-flight result and prevents future work', () => {
  const job = createLoopJob({runId:'durable3',task:'Simple'});
  const step = nextLoopStep(job);
  const stopped = requestLoopStop(job);
  assert.equal(stopped.status,'stopped');
  assert.equal(stopped.revision,job.revision+1);
  assert.equal(nextLoopStep(stopped),null);
  assert.throws(()=>completeLoopStep(stopped,{...step,output:'late'}),/No queued step/);
  assert.equal(requestLoopStop(stopped),stopped);
});

test('enforces 1-2 round bounds', () => {
  assert.throws(()=>createLoopJob({runId:'d4',task:'Valid',maxRounds:3}),RangeError);
  assert.throws(()=>createLoopJob({runId:'d4',task:'Valid',maxRounds:0}),RangeError);
  let job=createLoopJob({runId:'d4',task:'Valid',maxRounds:1});
  for(let i=0;i<2;i++){const step=nextLoopStep(job); job=completeLoopStep(job,{...step,output:'ok'});}
  assert.equal(job.status,'completed');
  assert.equal(job.calls_used,2);
});

test('rejects invalid IDs, tasks and outputs before updating state', () => {
  assert.throws(()=>createLoopJob({runId:'../evil',task:'Valid'}),TypeError);
  assert.throws(()=>createLoopJob({runId:'ok',task:' '}),TypeError);
  const job=createLoopJob({runId:'durable5',task:'Valid'});
  assert.throws(()=>completeLoopStep(job,{...nextLoopStep(job),output:'x'.repeat(3001)}),TypeError);
  assert.equal(job.revision,0);
  assert.equal(job.calls_used,0);
});
