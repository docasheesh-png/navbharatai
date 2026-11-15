/**
 * Pro Chain V2 — what the build report says (admin-only, like every provider name in it).
 *
 * One line per agent start, per engine change, per fallback, per Surplus drop, per failed supplier call
 * (status · code · latency · model · redacted message) and per estimated price/usage — plus a running
 * per-agent summary — so a z@ test build can be autopsied from its report alone. Bounded so a long build
 * cannot flood the timeline. PURE formatting; the sink is injected.
 */
import type { ProChainV2Event } from './agentRunner';
import type { SupplierCallEvent } from './builderAdapters';

export interface ProChainV2ReportLine {
  phase: 'provider';
  severity: 'info' | 'warning';
  code: string;
  message: string;
  detail?: string;
  autoResolved: true;
}

export const PRO_CHAIN_V2_MAX_REPORT_LINES = 250;

export function proChainV2EventLine(e: ProChainV2Event): ProChainV2ReportLine | null {
  switch (e.kind) {
    case 'agent-start':
      return { phase: 'provider', severity: 'info', code: 'PRO_CHAIN_V2_AGENT', autoResolved: true,
        message: `[v2] ${e.agent} started — SURPLUS ${e.surplus}; then ${e.chain.join(' → ') || '(no engine configured)'}` };
    case 'provider-used':
      return e.fellBackFrom.length || e.sticky
        ? { phase: 'provider', severity: 'info', code: 'PRO_CHAIN_V2_ENGINE', autoResolved: true,
          message: `[v2] ${e.agent} answered by ${e.provider}${e.fellBackFrom.length ? ` after ${e.fellBackFrom.join(' → ')}` : ''}${e.sticky ? ' (sticky)' : ''}` }
        : null;
    case 'provider-failed':
      return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_FALLBACK', autoResolved: true,
        message: `[v2] ${e.agent}: ${e.provider} failed — trying the next engine`, detail: e.reason };
    case 'surplus-dropped':
      return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_PRIMARY_DROPPED', autoResolved: true,
        message: `[v2] ${e.agent} left SURPLUS (${e.reason}); other agents keep their own engine`, detail: e.reason };
    case 'surplus-skip-open':
      return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_PRIMARY_SKIP', autoResolved: true,
        message: `[v2] ${e.drops} agents lost SURPLUS — new agents start past it until ${new Date(e.untilMs).toISOString()}` };
    case 'chain-exhausted':
      return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_EXHAUSTED', autoResolved: true,
        message: `[v2] ${e.agent}: every engine in its chain failed this turn`, detail: e.reason };
    default:
      return null;
  }
}

export function supplierCallLine(e: SupplierCallEvent): ProChainV2ReportLine | null {
  if (e.ok && !e.usageEstimated) return null;
  if (e.ok) {
    return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_USAGE_ESTIMATED', autoResolved: true,
      message: `[v2] ${e.provider}${e.model ? ` (${e.model})` : ''} returned no token usage — this turn's tokens are ESTIMATED (≈4 chars/token) and billed as an estimate`,
      detail: `latency=${e.latencyMs}ms` };
  }
  const bits = [e.status !== undefined ? `status=${e.status}` : '', e.code ? `code=${e.code}` : '', `latency=${e.latencyMs}ms`, e.model ? `model=${e.model}` : ''].filter(Boolean);
  return { phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_CALL_FAILED', autoResolved: true,
    message: `[v2] ${e.provider} call failed (${bits.join(' · ')})`, detail: e.message };
}

/** Per-agent tally, read live into the report's `proChainV2` field. */
export class ProChainV2Summary {
  private readonly byAgent = new Map<string, Map<string, number>>();
  private fallbacks = 0;
  private surplusDrops = 0;
  private readonly failed = new Map<string, number>();
  private readonly rates = new Map<string, string>();
  private readonly estimated = new Map<string, number>();
  constructor(private readonly reason: string) {}
  private bump(agent: string, provider: string): void {
    const m = this.byAgent.get(agent) ?? new Map<string, number>();
    m.set(provider, (m.get(provider) ?? 0) + 1);
    this.byAgent.set(agent, m);
  }
  add(e: ProChainV2Event): void {
    if (e.kind === 'provider-used') {
      this.bump(e.agent, e.provider);
      if (e.fellBackFrom.length) this.fallbacks += 1;
    } else if (e.kind === 'surplus-dropped') this.surplusDrops += 1;
  }
  /** A Surplus turn answered for this agent (the Surplus runner reports it itself). */
  addSurplusTurn(agent: string): void { this.bump(agent, 'SURPLUS'); }
  addCall(e: SupplierCallEvent, rateSource?: string): void {
    if (!e.ok) this.failed.set(e.provider, (this.failed.get(e.provider) ?? 0) + 1);
    if (e.ok && e.usageEstimated) this.estimated.set(e.provider, (this.estimated.get(e.provider) ?? 0) + 1);
    if (e.ok && rateSource) this.rates.set(`${e.provider}${e.model ? `:${e.model}` : ''}`, rateSource);
  }
  snapshot(): {
    reason: string; agents: Record<string, Record<string, number>>; fallbackTurns: number; surplusDrops: number;
    failedCalls: Record<string, number>; rateSources: Record<string, string>; usageEstimatedTurns: Record<string, number>;
  } {
    const agents: Record<string, Record<string, number>> = {};
    for (const [a, m] of this.byAgent) agents[a] = Object.fromEntries(m);
    return {
      reason: this.reason, agents, fallbackTurns: this.fallbacks, surplusDrops: this.surplusDrops,
      failedCalls: Object.fromEntries(this.failed), rateSources: Object.fromEntries(this.rates),
      usageEstimatedTurns: Object.fromEntries(this.estimated),
    };
  }
}
