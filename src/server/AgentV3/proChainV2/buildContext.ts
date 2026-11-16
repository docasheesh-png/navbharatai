/**
 * Pro Chain V2 — one build's context: the shared memory every agent of the build may share (fatal
 * dead rungs are the caller's; the Surplus skip counter is here), the report sink, and the factory that
 * gives every agent its own chain. Created once per build in routes/agentv3.ts ONLY when
 * `proChainV2EnabledFor(tier, email, uid)` is true; absent ⇒ every code path is the pre-v2 one.
 */
import type { TurnRunner } from '../ClaudeClient';
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import { isSurplusPublicBuildEngineFailure, surplusPreWriteFailOpenReason } from '../../AI/SurplusRegistry/surplusPreWriteFailOpen';
import { recordSurplusAdmitProbeSuccess, recordSurplusMidBuildDeath } from '../../AI/SurplusRegistry/surplusAdmitCircuit';
import { runWithSurplusBuild } from '../../AI/inferencePolicy';
import { ROUTER_ONE_LABEL } from '../../AI/RouterOne/routerOne';
import { createProChainV2AgentRunner, createProChainV2BuildState, nextAgentId, type ProChainV2BuildState, type ProChainV2Event, type ProChainV2Provider } from './agentRunner';
import { mitrifyBuilderRungs, observeRouterOneRungs, qubaxBuilderRungs, type RungFactory, type SupplierCallEvent } from './builderAdapters';
import { proChainV2SupplierRate } from './supplierRates';
import { PRO_CHAIN_V2_MAX_REPORT_LINES, ProChainV2Summary, proChainV2EventLine, supplierCallLine, type ProChainV2ReportLine } from './telemetry';
import type { ScopeUsageRow } from './scopeAsk';

export interface ProChainV2AgentRequest {
  /** planner | builder | writer | healer | retry | escalation — see roleForRunnerOpts. */
  role: string;
  /** This agent's own Surplus runner (absent when the build has no admitted Surplus session). */
  surplus?: TurnRunner;
  /** Router One rungs from its existing builder entry point (empty when not eligible). */
  routerOne: NamedRunner[];
  routerOneSecrets?: string[];
  rungFactory: RungFactory;
  /** Multi-provider runner over these rungs, wired to the caller's billing/report callbacks. */
  makeChain: (rungs: NamedRunner[], hooks: { onUsed: (reportName: string) => void; onFailed: (reportName: string, err: unknown) => void }) => TurnRunner;
  onSurplusError?: (err: unknown) => void;
  onChain?: (rungs: NamedRunner[]) => void;
}

/** Which agent role a buildTurnRunner option bag describes. PURE. */
export function roleForRunnerOpts(o: { plan?: boolean; heal?: boolean; afterLeadRung?: boolean; fromProvider?: unknown }): string {
  if (o.plan) return 'planner';
  if (o.afterLeadRung) return 'retry';
  if (o.fromProvider) return 'escalation';
  if (o.heal) return 'healer';
  return 'builder';
}

export class ProChainV2Build {
  readonly state: ProChainV2BuildState = createProChainV2BuildState();
  readonly summary: ProChainV2Summary;
  /** Scope-classifier usage (Qubax/Mitrify), added to the build ledger when it exists. */
  readonly scopeUsage: ScopeUsageRow[] = [];
  private lines = 0;
  private sink?: (line: ProChainV2ReportLine) => void;
  private readonly pending: ProChainV2ReportLine[] = [];

  constructor(readonly reason: string, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.summary = new ProChainV2Summary(reason);
  }

  /** Attach the build report sink; lines recorded before it existed are flushed in order. */
  attachReport(sink: (line: ProChainV2ReportLine) => void): void {
    this.sink = sink;
    for (const l of this.pending.splice(0)) this.write(l);
  }

  report(line: ProChainV2ReportLine | null): void {
    if (!line) return;
    if (!this.sink) { if (this.pending.length < 50) this.pending.push(line); return; }
    this.write(line);
  }

  private write(line: ProChainV2ReportLine): void {
    if (this.lines >= PRO_CHAIN_V2_MAX_REPORT_LINES) return;
    this.lines += 1;
    try { this.sink?.(line); } catch { /* diagnostics are best-effort */ }
  }

  onEvent = (e: ProChainV2Event): void => {
    try { this.summary.add(e); } catch { /* observation only */ }
    this.report(proChainV2EventLine(e));
  };

  onCall = (e: SupplierCallEvent): void => {
    let source: string | undefined;
    try { source = e.ok ? proChainV2SupplierRate(e.provider, e.model, this.env)?.source : undefined; } catch { source = undefined; }
    try { this.summary.addCall(e, source); } catch { /* observation only */ }
    this.report(supplierCallLine(e));
    if (e.ok && source === 'estimated') {
      this.report({ phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_RATE_ESTIMATED', autoResolved: true,
        message: `[v2] ${e.provider}${e.model ? ` (${e.model})` : ''} has no verified price — its turns are billed at a conservative ESTIMATE` });
    }
  };

  /** One agent, its own chain. */
  agentRunner(req: ProChainV2AgentRequest): TurnRunner {
    const agent = nextAgentId(this.state, req.role);
    const providers: ProChainV2Provider[] = [
      { label: ROUTER_ONE_LABEL, rungs: observeRouterOneRungs(req.routerOne, ROUTER_ONE_LABEL, req.routerOneSecrets ?? [], this.onCall) },
      { label: 'ENGINE_QX', rungs: qubaxBuilderRungs(req.rungFactory, this.env, this.onCall) },
      { label: 'ENGINE_MF', rungs: mitrifyBuilderRungs(req.rungFactory, this.env, this.onCall) },
    ];
    try { req.onChain?.(providers.flatMap((p) => p.rungs)); } catch { /* observation only */ }
    const surplus = req.surplus;
    const countedSurplus: TurnRunner | undefined = surplus ? {
      ...surplus,
      runTurn: async (params) => {
        const r = await surplus.runTurn(params);
        try { this.summary.addSurplusTurn(agent); } catch { /* observation only */ }
        return r;
      },
    } : undefined;
    return createProChainV2AgentRunner({
      agent,
      ...(countedSurplus ? { surplus: countedSurplus } : {}),
      providers,
      makeChain: req.makeChain,
      state: this.state,
      surplusRecoverable: isSurplusPublicBuildEngineFailure,
      surplusReason: (err) => surplusPreWriteFailOpenReason(err),
      escapeSurplusScope: (fn) => runWithSurplusBuild(false, fn),
      ...(req.onSurplusError ? { onSurplusError: req.onSurplusError } : {}),
      onSurplusHealthy: () => recordSurplusAdmitProbeSuccess(),
      onFirstSurplusDrop: (reason) => { recordSurplusMidBuildDeath(reason); },
      onEvent: this.onEvent,
      secrets: [...(req.routerOneSecrets ?? []), ...String(this.env.QUBAX_API_KEY ?? '').split(/[\s,]+/), ...String(this.env.MITRIFY_API_KEY ?? '').split(/[\s,]+/)],
      env: this.env,
    });
  }
}
