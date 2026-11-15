/**
 * Pro Chain V2 — ONE AGENT'S CHAIN (owner t350u: "alag alag agent alag alag provider use kare … sabhi
 * apne apne hisab se chale").
 *
 * Every runner the build constructs (planner, builder, each fast-lane file writer, each healer, the
 * retry and escalation runners) is one AGENT and gets its own instance of this runner, so:
 *
 *   • SURPLUS FIRST, PER AGENT. A Surplus failure drops Surplus for THIS agent only and retries the same
 *     turn down the agent's own chain. Other agents stay on Surplus. (Today's Weak path drops Surplus for
 *     the whole build at once.) Only after `surplusSkipAfter` different agents of the same build lost it
 *     do NEW agents start past it for `surplusSkipMs` — so a dead Surplus does not cost every new
 *     file-writer its own slow failure, while every agent already running keeps its own choice.
 *   • ROUTER ONE → QUBAX → MITRIFY, PER AGENT. The tail is the builder's ordinary multi-provider runner
 *     (bench, stop, deadline, maintenance and fatal-error rules unchanged) built over this agent's order.
 *   • STICKY, PER AGENT, BUT NOT FOREVER. The engine that answered becomes the agent's first choice for
 *     `stickyTurns` turns, then the owner's order is tried again — so one transient Router One error does
 *     not exile an agent to Mitrify for the rest of the build.
 *
 * Shared across agents, on purpose: only the build's fatal dead-rung memory (a revoked key is revoked for
 * everyone) and the Surplus skip counter above. Everything is injected, so this module is PURE control
 * flow, unit-testable without a key, and portable into the main engine as-is.
 */
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import { isBuildStoppedError } from '../stopSignal';
import { proChainV2Tuning } from './policy';
import { redactSecrets } from './redact';

export const PRO_CHAIN_V2_NO_ENGINE = 'No build engine is configured for this build right now. Please try again shortly.';

export interface ProChainV2Provider {
  /** 'ENGINE_R1' | 'ENGINE_QX' | 'ENGINE_MF' — the label every rung of it reports as. */
  label: string;
  rungs: NamedRunner[];
}

export type ProChainV2Event =
  | { kind: 'agent-start'; agent: string; surplus: 'first' | 'skipped' | 'absent'; chain: string[] }
  | { kind: 'provider-used'; agent: string; provider: string; fellBackFrom: string[]; sticky: boolean }
  | { kind: 'provider-failed'; agent: string; provider: string; reason: string }
  | { kind: 'surplus-dropped'; agent: string; reason: string }
  | { kind: 'surplus-skip-open'; agent: string; drops: number; untilMs: number }
  | { kind: 'chain-exhausted'; agent: string; reason: string };

export interface ProChainV2BuildState {
  /** Wall-clock times at which an agent of this build lost Surplus. */
  surplusDrops: number[];
  /** New agents start past Surplus until this time. */
  skipSurplusUntil: number;
  /** The cross-build Surplus circuit is told about this build's FIRST drop only (today's cadence). */
  firstDropRecorded: boolean;
  /** Per-role counters for readable agent ids: builder#1, writer#3, healer#2 … */
  agentSeq: Map<string, number>;
}

export function createProChainV2BuildState(): ProChainV2BuildState {
  return { surplusDrops: [], skipSurplusUntil: 0, firstDropRecorded: false, agentSeq: new Map() };
}

export function nextAgentId(state: ProChainV2BuildState, role: string): string {
  const n = (state.agentSeq.get(role) ?? 0) + 1;
  state.agentSeq.set(role, n);
  return `${role}#${n}`;
}

export interface ProChainV2AgentOptions {
  agent: string;
  /** This agent's own Surplus runner; absent when the build has no admitted Surplus session. */
  surplus?: TurnRunner;
  /** In the owner's order (Router One, Qubax, Mitrify); empty providers are ignored. */
  providers: ProChainV2Provider[];
  /** Build a multi-provider runner over these rungs (production: makeMultiProviderTurnRunner + the build's callbacks). */
  makeChain: (rungs: NamedRunner[], hooks: { onUsed: (reportName: string) => void; onFailed: (reportName: string, err: unknown) => void }) => TurnRunner;
  state: ProChainV2BuildState;
  /** May this Surplus error move the turn to the tail? (production: isSurplusPublicBuildEngineFailure) */
  surplusRecoverable: (err: unknown) => boolean;
  /** Safe, supplier-free reason token for a recoverable Surplus error. */
  surplusReason?: (err: unknown) => string;
  /** Run the tail outside the request's "Surplus-only" inference guard, for THIS call only. */
  escapeSurplusScope?: <T>(fn: () => Promise<T>) => Promise<T>;
  onSurplusError?: (err: unknown) => void;
  onSurplusHealthy?: () => void;
  onFirstSurplusDrop?: (reason: string) => void;
  onEvent?: (e: ProChainV2Event) => void;
  /** Exact key values to strip from any failure reason (shape-based redaction applies regardless). */
  secrets?: readonly string[];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export function createProChainV2AgentRunner(o: ProChainV2AgentOptions): TurnRunner {
  const now = o.now ?? Date.now;
  const tuning = proChainV2Tuning(o.env ?? process.env);
  const providers = o.providers.filter((p) => p.rungs.length > 0);
  const canonical = providers.map((p) => p.label);
  // Every reason text is a supplier's own words: strip keys (exact values + key shapes) before anyone sees it.
  const emit = (e: ProChainV2Event): void => {
    try { o.onEvent?.('reason' in e ? { ...e, reason: redactSecrets(e.reason, o.secrets ?? []).slice(0, 300) } : e); } catch { /* observation only */ }
  };
  const escape = o.escapeSurplusScope ?? (<T>(fn: () => Promise<T>) => fn());

  let surplusDropped = false;
  let started = false;
  let sticky: { label: string; turnsLeft: number } | null = null;
  const chains = new Map<string, { runner: TurnRunner; used: { name: string | null } }>();

  const orderFor = (): string[] => {
    if (!sticky || sticky.turnsLeft <= 0 || !canonical.includes(sticky.label)) return canonical;
    return [sticky.label, ...canonical.filter((l) => l !== sticky!.label)];
  };
  const chainFor = (order: string[]) => {
    const key = order.join('>');
    let c = chains.get(key);
    if (!c) {
      const used = { name: null as string | null };
      const rungs = order.flatMap((l) => providers.find((p) => p.label === l)?.rungs ?? []);
      c = {
        runner: o.makeChain(rungs, {
          onUsed: (name) => { used.name = name; },
          onFailed: (name, err) => emit({ kind: 'provider-failed', agent: o.agent, provider: labelOf(name) ?? name, reason: redactSecrets(err instanceof Error ? err.message : String(err), o.secrets ?? []).slice(0, 300) }),
        }),
        used,
      };
      chains.set(key, c);
    }
    return c;
  };
  const labelOf = (reportName: string | null): string | null => {
    if (!reportName) return null;
    const base = reportName.replace(/#\d+$/, '');
    return canonical.find((l) => l === base) ?? base;
  };

  // The build-wide skip is read ONCE, when the agent starts: an agent already running keeps its own choice.
  let skippedAtStart = false;
  const surplusUsable = (): boolean => !!o.surplus && !surplusDropped && !skippedAtStart;

  const runTail = async (params: RunTurnParams): Promise<TurnResult> => {
    if (providers.length === 0) {
      emit({ kind: 'chain-exhausted', agent: o.agent, reason: 'no engine configured after Surplus' });
      throw new Error(PRO_CHAIN_V2_NO_ENGINE);
    }
    const order = orderFor();
    const c = chainFor(order);
    c.used.name = null;
    try {
      const result = await escape(() => c.runner.runTurn(params));
      const label = labelOf(c.used.name);
      const wasSticky = !!sticky && sticky.turnsLeft > 0 && order[0] === sticky.label;
      if (wasSticky && label === sticky!.label) sticky!.turnsLeft -= 1;
      else if (label && label !== canonical[0]) sticky = { label, turnsLeft: tuning.stickyTurns };
      else sticky = null;
      if (label) emit({ kind: 'provider-used', agent: o.agent, provider: label, fellBackFrom: order.slice(0, Math.max(0, order.indexOf(label))), sticky: wasSticky });
      return result;
    } catch (err) {
      if (!(isBuildStoppedError(err) || params.signal?.aborted)) {
        emit({ kind: 'chain-exhausted', agent: o.agent, reason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
      }
      throw err;
    }
  };

  const planned = providers[0]?.rungs[0]?.modelId;
  return {
    ...(planned ? { plannedModel: planned } : {}),
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      if (!started) {
        started = true;
        skippedAtStart = now() < o.state.skipSurplusUntil;
        emit({ kind: 'agent-start', agent: o.agent, surplus: !o.surplus ? 'absent' : surplusUsable() ? 'first' : 'skipped', chain: canonical });
      }
      if (surplusUsable()) {
        try {
          const result = await o.surplus!.runTurn(params);
          try { o.onSurplusHealthy?.(); } catch { /* never block the turn */ }
          return result;
        } catch (err) {
          try { o.onSurplusError?.(err); } catch { /* observer must never alter the turn */ }
          // A stop, an abort, a policy/maintenance/spend refusal is never "try another engine".
          if (isBuildStoppedError(err) || params.signal?.aborted || !o.surplusRecoverable(err)) throw err;
          const reason = (() => { try { return o.surplusReason?.(err) ?? 'mid_build_engine_unavailable'; } catch { return 'mid_build_engine_unavailable'; } })();
          surplusDropped = true;
          const t = now();
          o.state.surplusDrops.push(t);
          emit({ kind: 'surplus-dropped', agent: o.agent, reason });
          if (!o.state.firstDropRecorded) {
            o.state.firstDropRecorded = true;
            try { o.onFirstSurplusDrop?.(reason); } catch { /* best-effort */ }
          }
          const recent = o.state.surplusDrops.filter((x) => t - x <= tuning.surplusSkipMs);
          o.state.surplusDrops = recent;
          if (recent.length >= tuning.surplusSkipAfter && o.state.skipSurplusUntil <= t) {
            o.state.skipSurplusUntil = t + tuning.surplusSkipMs;
            emit({ kind: 'surplus-skip-open', agent: o.agent, drops: recent.length, untilMs: o.state.skipSurplusUntil });
          }
        }
      }
      return runTail(params);
    },
  } as TurnRunner;
}
