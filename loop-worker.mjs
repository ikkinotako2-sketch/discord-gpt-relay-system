// Offline-staged adapter for Cloudflare Workers AI; NOT exposed to Discord.
// WARNING: Four consecutive inference calls can exceed the Worker execution
// lifetime. Before making this live, use a durable queue / job state machine.
import { runBoundedLoop } from './loop-core.mjs';
import { generateWithWorkersAI } from './worker-relay.mjs';

export async function runWorkersAiBoundedLoop({ env, runId, task, maxRounds = 2, shouldStop }) {
  if (!env?.AI?.run) throw new Error('AI binding unavailable');
  return runBoundedLoop({
    runId, task, maxRounds, shouldStop,
    generate: ({role,task,context}) => generateWithWorkersAI(env,{role,task,context}),
  });
}
