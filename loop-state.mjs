// Pure durable-loop state transitions. No database I/O and no provider calls.
// A future D1 adapter MUST use revision-based atomic compare-and-swap updates.
const MAX_TEXT = 3000;
function bounded(s, max, label) {
  if (typeof s !== 'string' || !s.trim() || s.length > max) {
    throw new TypeError(label + ' must be nonempty text <= ' + max + ' characters');
  }
  return s.trim();
}

export function createLoopJob({ runId, task, maxRounds = 2 }) {
  const id = bounded(runId, 120, 'runId');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new TypeError('Invalid runId');
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 2) {
    throw new RangeError('maxRounds must be 1 or 2');
  }
  return {
    schema: 'loop.state.v1',
    run_id: id, task: bounded(task, 1000, 'task'),
    max_rounds: maxRounds, round: 1, role: 'planner', revision: 0,
    status: 'queued', calls_used: 0, plan: null, previous_artifact: null,
    history: [],
  };
}

export function nextLoopStep(job) {
  if (!job || job.schema !== 'loop.state.v1') throw new TypeError('Invalid loop job');
  if (job.status !== 'queued') return null;
  return {
    runId: job.run_id, task: job.task, round: job.round, role: job.role,
    context: job.role === 'planner' ? job.previous_artifact ?? '' : job.plan,
    expectedRevision: job.revision,
  };
}

export function completeLoopStep(job, { expectedRevision, role, round, output }) {
  const step = nextLoopStep(job);
  if (!step) throw new Error('No queued step');
  if (expectedRevision !== step.expectedRevision || role !== step.role || round !== step.round) {
    throw new Error('Stale or mismatched step; must not commit model output twice');
  }
  if (job.calls_used >= job.max_rounds * 2) throw new Error('Model call budget exhausted');
  const validated = bounded(output, MAX_TEXT, 'model output');
  const history = [...job.history, {round, role, output: validated}];

  if (role === 'planner') {
    return {
      ...job, plan: validated, history, role: 'builder',
      calls_used: job.calls_used + 1, revision: job.revision + 1,
    };
  }
  const done = job.round >= job.max_rounds;
  return {
    ...job, history, plan: null, previous_artifact: validated,
    status: done ? 'completed' : 'queued',
    role: done ? null : 'planner', round: done ? job.round : job.round + 1,
    calls_used: job.calls_used + 1, revision: job.revision + 1,
  };
}

export function requestLoopStop(job) {
  if (!job || job.schema !== 'loop.state.v1') throw new TypeError('Invalid loop job');
  if (job.status !== 'queued') return job;
  return {
    ...job, status: 'stopped', role: null, revision: job.revision + 1,
  };
}
