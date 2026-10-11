// Provider-neutral finite agent handoff loop.
// Does not automate consumer ChatGPT sessions or make network calls.
const MAX_TASK_LENGTH = 1000;
const MAX_OUTPUT_LENGTH = 3000;
const MAX_ROUNDS = 2;

function bounded(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${label} must be nonempty text <= ${max} characters`);
  }
  return value.trim();
}

function validRunId(value) {
  const runId = bounded(value, 'runId', 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new TypeError('invalid runId');
  return runId;
}

/**
 * Exactly two agent calls per completed round: planner -> builder.
 * The next planner receives the previous builder artifact as reference context.
 *
 * Safety/operational bounds:
 * - explicit invocation only; never self-schedules
 * - at most 2 rounds / 4 model calls per invocation
 * - no retries, external actions, persistent state or automatic publishing
 * - optional cooperative stop before *each* model call
 * - failure propagates to caller, never silently continues
 *
 * The `generate` callback is provider-neutral; caller is responsible for
 * credentials, moderation, latency, and audit trail.
 */
export async function runBoundedLoop({
  runId, task, generate, maxRounds = 2, shouldStop = () => false,
}) {
  const id = validRunId(runId);
  const input = bounded(task, 'task', MAX_TASK_LENGTH);
  if (typeof generate !== 'function') throw new TypeError('generate callback required');
  if (typeof shouldStop !== 'function') throw new TypeError('shouldStop callback required');
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS) {
    throw new RangeError('maxRounds must be 1..2');
  }

  const rounds = [];
  let callsUsed = 0;
  let context = '';

  for (let round = 1; round <= maxRounds; round++) {
    if (await shouldStop({ runId: id, roundsCompleted: rounds.length, callsUsed })) {
      return { run_id: id, status: 'stopped_by_request', rounds, calls_used: callsUsed };
    }

    const plan = bounded(await generate({
      role: 'planner', round, task: input, context, runId: id,
    }), 'plan', MAX_OUTPUT_LENGTH);
    callsUsed++;

    if (await shouldStop({ runId: id, roundsCompleted: rounds.length, callsUsed })) {
      return { run_id: id, status: 'stopped_by_request', rounds, calls_used: callsUsed };
    }

    const artifact = bounded(await generate({
      role: 'builder', round, task: input, context: plan, runId: id,
    }), 'artifact', MAX_OUTPUT_LENGTH);
    callsUsed++;
    rounds.push({ round, plan, artifact });
    context = artifact;
  }

  return {
    run_id: id,
    status: 'stopped_at_round_limit',
    rounds,
    calls_used: callsUsed,
    max_rounds: maxRounds,
    final_artifact: context,
  };
}
