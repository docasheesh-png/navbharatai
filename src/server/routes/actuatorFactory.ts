// The ONE sandbox-selection decision (E2B → Docker → Local), in a module of its own.
//
// WHY IT MOVED OUT OF routes/agentv3.ts (2026-08-06). `routes/zipUpload` needs exactly this function
// and nothing else from that file — but importing it dragged in the ENTIRE AgentV3 engine, because
// `agentv3.ts` is the largest module in the repo. Measured: importing `routes/zip` (which imports
// `zipUpload`, which imported `agentv3`) took **6.5 seconds**, against 43 ms for `zip.ts`'s own body.
//
// That cost two things, one visible and one not:
//   • every server BOOT paid it, on a path that has nothing to do with building apps;
//   • and it made a test flaky in a way that looked like anything else — whichever of the two zip
//     route tests happened to import the module FIRST paid the 5-second-ish cost and randomly crossed
//     vitest's 5000 ms timeout. In a suite of 12,000 tests that reads as "a random test sometimes
//     fails", and the real cause is an import graph nobody looks at.
//
// The singleton lives HERE and `agentv3.ts` re-exports it, so there is still exactly one actuator per
// process — which is the whole point of it: the actuator's per-workspace sandbox map is what lets
// consecutive messages in a session reuse the SAME sandbox, its files, its node_modules and its dev
// server. Two instances would silently give the second message a cold, empty sandbox.

import { IEngineerActuator } from '../AgentV3/sandbox/EngineerAI/actuators/IEngineerActuator';
import { E2BActuator } from '../AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../AgentV3/sandbox/EngineerAI/actuators/DockerActuator';
import { LocalActuator } from '../AgentV3/sandbox/EngineerAI/actuators/LocalActuator';
import { envFlag } from '../lib/envFlag';

/**
 * Cached as a process-level singleton so the actuator's per-workspace sandbox map survives across
 * requests — that is what lets consecutive messages in the same session reuse the SAME sandbox (and its
 * files, node_modules and dev server), enabling iterative building ("add a login page" after "build a
 * todo app").
 */
let sharedActuator: IEngineerActuator | null = null;

/**
 * Hybrid sandbox selection (D4): E2B for real builds, Docker/Local fallbacks.
 *
 * Exported so every route that writes workspace files — the build route, the chunked zip import —
 * reuses the SAME actuator instance and the same environment rules, instead of duplicating the
 * selection and drifting from it.
 */
export function buildActuator(): IEngineerActuator {
  if (sharedActuator) return sharedActuator;
  if (process.env.E2B_API_KEY) sharedActuator = new E2BActuator();
  else if (envFlag('DOCKER_ENABLED')) sharedActuator = new DockerActuator();
  else sharedActuator = new LocalActuator();
  return sharedActuator;
}
