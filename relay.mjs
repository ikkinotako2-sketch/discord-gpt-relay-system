const MAX_TASK_LENGTH = 1000;
const MAX_TEXT_LENGTH = 3000;
export const ROLES = Object.freeze(['planner', 'builder']);

function boundedText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${label} must be nonempty text <= ${max} characters`);
  }
  return value.trim();
}

export function makeHandoff({ runId, task, planning, iteration = 1, maxIterations = 3 }) {
  const id = boundedText(runId, 'runId', 120);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new TypeError('invalid runId');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 3) {
    throw new RangeError('maxIterations must be 1..3');
  }
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > maxIterations) {
    throw new RangeError('iteration out of bounds');
  }
  return Object.freeze({
    schema: 'relay.handoff.v1', run_id: id, iteration, max_iterations: maxIterations,
    role: 'builder', status: 'pending',
    task: boundedText(task, 'task', MAX_TASK_LENGTH),
    context: boundedText(planning, 'planning', MAX_TEXT_LENGTH),
    artifact: null,
  });
}

export async function relayOnce({ runId, task, generate, maxIterations = 3 }) {
  if (typeof generate !== 'function') throw new TypeError('generate must be a function');
  const validTask = boundedText(task, 'task', MAX_TASK_LENGTH);
  const planner = await generate({ role: 'planner', task: validTask, context: '' });
  const plan = boundedText(planner, 'planner output', MAX_TEXT_LENGTH);
  const handoff = makeHandoff({ runId, task: validTask, planning: plan, maxIterations });
  const builder = await generate({ role: 'builder', task: validTask, context: handoff.context });
  const artifact = boundedText(builder, 'builder output', MAX_TEXT_LENGTH);
  return Object.freeze({
    run_id: handoff.run_id, status: 'completed', iterations_used: 1,
    max_iterations: maxIterations, stages: Object.freeze([
      { role: 'planner', output: plan },
      { role: 'builder', output: artifact },
    ]),
    handoff: Object.freeze({ ...handoff, status: 'completed', artifact }),
  });
}
