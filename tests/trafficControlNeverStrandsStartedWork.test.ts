/**
 * Traffic Manager V2, P2 — owner requirement 10: "Prevent duplicate execution, duplicate billing, and unsafe fallback
 * behavior." The control store may stop NEW work only. Where in the gateway each check reads it is the whole safety
 * story, so these guards pin it:
 *   · ingress (`runWithAuthenticatedInferenceGatewayRequest`) and `inferenceGatewayEnabled` read it — before any
 *     provider is called, so a request sent down the legacy path was never dispatched by the gateway;
 *   · the planner reads it through `controlGate`, supplied ONLY where a new attempt is planned (executor.ts);
 *   · the mid-request re-check (`selectedCohortCurrent`, `verifiedPrincipal`) and the ledger's re-plan of an attempt
 *     already selected NEVER read it, so a switch flipped mid-request cannot strand, re-run or double-charge it.
 * Reverting any of these makes this file fail.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inferenceGatewayEnabled } from '../src/server/AI/InferenceGateway/runtime';
import { __resetTrafficControlSyncForTests, adoptTrafficControl } from '../src/server/AI/TrafficRegistry/controlSync';

const runtime = readFileSync('src/server/AI/InferenceGateway/runtime.ts', 'utf8');
const ledger = readFileSync('src/server/AI/InferenceGateway/firestoreLedger.ts', 'utf8');
const executor = readFileSync('src/server/AI/InferenceGateway/executor.ts', 'utf8');
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  let depth = 0; let i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(open, i + 1);
}

describe('the control store stops new work only', () => {
  it('the mid-request re-check reads the env alone', () => {
    const b = body(runtime, 'function selectedCohortCurrent(');
    expect(b).not.toMatch(/currentTrafficControl|controlAllowsGateway|inferenceGatewayEnabled\(|[^v]fixedConversation\(/);
    expect(b).toMatch(/envGatewayEnabled\(/);
  });
  it('the principal check before dispatch reads the env alone', () => {
    expect(body(runtime, 'function verifiedPrincipal(')).not.toMatch(/[^v]fixedConversation\(|currentTrafficControl/);
  });
  it('ingress takes ONE control snapshot per request', () => {
    const b = body(runtime, 'export async function runWithAuthenticatedInferenceGatewayRequest');
    expect(b.match(/currentTrafficControl\(\)/g)).toHaveLength(1);
  });
  it('only the executor supplies the gate; the ledger re-check of a selected attempt never does', () => {
    expect(executor).toMatch(/controlGate:/);
    expect(ledger).not.toMatch(/controlGate|currentTrafficControl|candidateVerdict/);
  });
});

describe('the global emergency OFF and a surface switch narrow the env, never widen it', () => {
  afterEach(() => { __resetTrafficControlSyncForTests(); vi.unstubAllEnvs(); });
  const doc = (over: object) => ({ global: { gateway: 'on' as const }, surfaces: {}, providers: {}, models: {}, revision: 1, updatedAtMs: 1, actor: 'a', reason: 'r', ...over });
  it('env ON + no document: the gateway serves chat exactly as before', () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'true'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat'); vi.stubEnv('TEXT_CHAIN_POLICY', 'legacy');
    expect(inferenceGatewayEnabled('chat')).toBe(true);
  });
  it('env ON + global OFF: legacy everywhere; env ON + chat legacy: legacy for chat only', () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'true'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat,professional'); vi.stubEnv('TEXT_CHAIN_POLICY', 'legacy');
    adoptTrafficControl(doc({ revision: 1, global: { gateway: 'off' } }));
    expect(inferenceGatewayEnabled('chat')).toBe(false);
    expect(inferenceGatewayEnabled()).toBe(false);
    adoptTrafficControl(doc({ revision: 2, surfaces: { chat: 'legacy' } }));
    expect(inferenceGatewayEnabled('chat')).toBe(false);
    expect(inferenceGatewayEnabled('professional')).toBe(true);
  });
  it('env OFF stays OFF whatever the document says (the deployment backstop, requirement 4)', () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'false');
    adoptTrafficControl(doc({ revision: 1 }));
    expect(inferenceGatewayEnabled('chat')).toBe(false);
  });
});
