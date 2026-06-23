// AgentV3 (Vargen 3.0) — public surface for the v3.0 agent engine.
//
// P0 ships the type vocabulary, the event spine (AgentEventStream), the state
// container (WorkspaceState), and the feature flag. The native tool-use build
// loop and the multi-agent team (Orchestrator/SubAgentRunner/ToolCatalog) land
// in P1+. See NAVBHARATAI_PRO_V3_DESIGN.md.

export * from './types';
export { AgentEventStream } from './AgentEventStream';
export type { AgentEventListener } from './AgentEventStream';
export { WorkspaceState } from './WorkspaceState';
export {
  isAgentV3Enabled,
  isAgentV3GloballyEnabled,
  agentV3Allowlist,
} from './featureFlag';
export { ClaudeClient, parseMessage, isRetryableError } from './ClaudeClient';
export type {
  ClaudeToolDef,
  ToolUse,
  TurnUsage,
  TurnResult,
  RetryOptions,
  RunTurnParams,
  TurnRunner,
  MessagesCreateClient,
} from './ClaudeClient';
export { AgentRunner } from './AgentRunner';
export type { AgentRunnerOptions, AgentRunResult } from './AgentRunner';
export { resolveModel, sonnetModel, opusModel } from './models';
export { architectSystemPrompt, planSystemPrompt } from './systemPrompt';
export { awaitApproval, resolveApproval, pendingApprovalCount } from './Approvals';
export {
  STANDARD_MULTIPLIER,
  ONLY_OPUS_MULTIPLIER,
  opusRate,
  opusEquivalentUsd,
  billedAmountUsd,
} from './pricing';
export type { BilledUsage } from './pricing';
export { defaultToolCatalog, CATALOG_TOOL_NAMES, taskToolDef, catalogForTools } from './ToolCatalog';
export { ToolDispatcher } from './ToolDispatcher';
export type { ActuatorPort, ToolResult, SubAgentSpawn } from './ToolDispatcher';
export { roleConfig, isWorkerRole, WORKER_ROLES, allRoles, findRolesByCapability, rolesByLayer, rosterBriefing } from './AgentRegistry';
export type { RoleConfig } from './AgentRegistry';
export { agentLifecycle } from './AgentLifecycle';
export type { AgentHealth, AgentPhase, RunToken } from './AgentLifecycle';
export { WorkspaceMemory, getWorkspaceMemory, extractFacts } from './WorkspaceMemory';
export type { ProjectGraph, SymbolInfo, Episode, MemorySnapshot, RecallHit } from './WorkspaceMemory';
export { analyzeArchitecture, architectureSummary, resolveLocalImport } from './ArchitectureAnalysis';
export type { ArchitectureReport } from './ArchitectureAnalysis';
export { scanSecurity, securitySummary } from './SecurityAnalysis';
export type { SecurityFinding, Severity } from './SecurityAnalysis';
export { assessReadiness, readinessVerdict } from './Readiness';
export type { ReadinessReport } from './Readiness';
export { makeSubAgentSpawn } from './SubAgent';
export type { SubAgentDeps } from './SubAgent';
export { GitManager } from './GitManager';
export type { Checkpointer, CommandRunner } from './GitManager';
export { registerSession, getSession, restoreSession, sessionCount } from './WorkspaceRegistry';
export type { WorkspaceSession } from './WorkspaceRegistry';

import { AGENTV3_PHASE } from './types';

export interface AgentV3Status {
  phase: typeof AGENTV3_PHASE;
  /** False until the native build loop ships (P1). Honest: not usable yet. */
  ready: boolean;
  /** The surfaces v3.0 merges into one synced engine (§3.2). */
  surfaces: string[];
  note: string;
}

/**
 * Honest engine status. `ready` stays false through P0 — the skeleton is live
 * but cannot build apps yet. Surfaces and the route use this to avoid ever
 * presenting a fake "it works" state (CLAUDE.md real-features rule).
 */
export function agentV3Status(): AgentV3Status {
  return {
    phase: AGENTV3_PHASE,
    ready: false,
    surfaces: ['preview', 'ide', 'files', 'git', 'history'],
    note:
      'AgentV3 P0 skeleton is live (types + event spine + workspace state + flag). ' +
      'The native tool-use build loop and multi-agent team ship in P1+. ' +
      'Not yet usable for real builds.',
  };
}
