import { AIRouterManager } from './AIRouterManager';
import type { TraceContext } from '../../../server';
import type { ProviderUsage } from './Router/ProviderTypes';

/**
 * What one routed call really was.
 *
 * 🔴 WHY THIS TYPE EXISTS (2026-09-12). `route()` returned ONLY the text, so every fact the router
 * already knew — which engine answered, which model, how long it took, and the tokens the provider
 * itself reported — was thrown away one line after it arrived. The chat route then had to write
 * SOMETHING into `ai_usage_logs`, and what it wrote was invented: `provider: 'auto'`, `model: 'auto'`,
 * `latencyMs: 0`, `estimated_provider_cost: 0`, and an output-token count derived from
 * `response.length / 4`.
 *
 * Those five fabrications are what the admin dashboard was built on, so it showed: engine cost ₹0.0000
 * however much was spent, "cost per request ₹0.00000", a PLATFORM MARGIN that was arithmetically just
 * revenue (revenue − 0), an API ranking where one imaginary provider called AUTO held 100% of traffic
 * at 0 ms, and a token total that was a character count divided by four.
 *
 * The truth was never missing — `AIProviderResponse` has carried `provider`, `model`, `latencyMs` and
 * an optional real `usage` all along. This returns it instead of discarding it.
 *
 * 🔒 `usage` STAYS OPTIONAL, and callers must keep it that way. A provider that reports no tokens
 * leaves it undefined, and the honest record is "not measured" — never a length-based guess, which is
 * exactly the failure this replaced. See ProviderTypes.ts and chatSpend.ts, which already say so.
 */
export interface RoutedCall {
  content: string;
  /** The engine that actually answered. `'NONE'` when every provider failed — never a guess. */
  provider: string;
  model: string;
  latencyMs: number;
  /** Tokens the provider reported. Absent = it reported none. */
  usage?: ProviderUsage;
  /** False when nothing answered and `content` is the apology, not an answer. */
  ok: boolean;
}

export class UniversalAIRouter {
  private readonly TIMEOUT_MS = 90000;

  async route(
    message: string,
    history: any[] = [],
    tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip' | 'sda' | 'doctor' | 'professional' = 'navbharat',
    traceContext?: TraceContext,
    systemPrompt?: string,
  ): Promise<string> {
    return (await this.routeDetailed(message, history, tier, traceContext, systemPrompt)).content;
  }

  /**
   * The same call, with everything the router knew about it.
   *
   * `route()` delegates here rather than duplicating the logic, so the text path and the telemetry
   * path can never drift — the bug this fixes was born from exactly that kind of split.
   */
  async routeDetailed(
    message: string,
    history: any[] = [],
    tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip' | 'sda' | 'doctor' | 'professional' = 'navbharat',
    _traceContext?: TraceContext,
    systemPrompt?: string,
  ): Promise<RoutedCall> {
    const ns = this.namespaceFor(tier);
    const router = AIRouterManager.getRouter(ns);
    const fullPrompt = this.buildPrompt(message, history);
    console.log(`[UNIVERSAL_ROUTER] tier=${tier} ns=${ns} promptLen=${fullPrompt.length}`);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.TIMEOUT_MS)
      );
      const { response, telemetry } = await Promise.race([router.route(fullPrompt, systemPrompt), timeout]);
      // 🔒 THE PROVIDER NAME COMES FROM TELEMETRY, NOT FROM THE RESPONSE. When every provider fails,
      // AIRouter still returns a response object stamped `provider: 'GEMINI', model: 'fallback'` so the
      // caller has a shape to read — but nothing from Gemini ran. Its telemetry says `provider: 'NONE'`
      // and `success: false`, which is the honest record, so that is the one recorded.
      const ok = telemetry?.success !== false;
      return {
        content: response.content,
        provider: ok ? (telemetry?.provider || response.provider) : 'NONE',
        model: ok ? response.model : 'none',
        latencyMs: Number.isFinite(telemetry?.latency) ? Number(telemetry.latency) : Number(response.latencyMs) || 0,
        usage: ok ? response.usage : undefined,
        ok,
      };
    } catch (e: any) {
      console.error('[UNIVERSAL_ROUTER] exhausted:', e.message);
      // Nothing answered, so nothing is claimed: no provider, no model, no tokens.
      return {
        content: 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏',
        provider: 'NONE', model: 'none', latencyMs: 0, ok: false,
      };
    }
  }

  async routeStream(
    message: string,
    history: any[],
    tier: string,
    systemPrompt: string | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const ns = this.namespaceFor(tier);
    const router = AIRouterManager.getRouter(ns);
    const fullPrompt = this.buildPrompt(message, history);
    await router.routeStream(fullPrompt, systemPrompt, onChunk, signal);
  }

  // Map a request tier to its ISOLATED router universe. Every professional AI —
  // Doctor AI (SDA), Teacher, Lawyer, CA, Astrologer, Kisan, … — shares the
  // 'professional' namespace (Grok→Gemini→Vertex→Claude-last) so the whole
  // professional universe is isolated from FREE and PRO and never shares routing
  // state with them. FREE must never reach Claude.
  private namespaceFor(tier: string): 'free' | 'pro' | 'professional' {
    if (tier === 'sda' || tier === 'doctor' || tier === 'professional') return 'professional';
    if (tier === 'vishwakarma-pro' || tier === 'vip') return 'pro';
    return 'free';
  }

  // Rolling context: last 15 turns at full detail, older ones as a compact summary line.
  private buildPrompt(message: string, history: any[]): string {
    if (!history || history.length === 0) return message;
    const MAX_RECENT = 15;
    const RECENT_CHARS = 1500;
    const OLDER_CHARS = 150;

    const summaryPart = history.length > MAX_RECENT
      ? `[Earlier session — ${history.length - MAX_RECENT} messages]: ` +
        history.slice(0, -MAX_RECENT)
          .map(m => `${m.sender === 'user' ? 'U' : 'A'}: ${String(m.text || m.content || '').slice(0, OLDER_CHARS)}`)
          .join(' | ') + '\n\n'
      : '';

    const recentHistory = history.slice(-MAX_RECENT)
      .map(m => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${String(m.text || m.content || '').slice(0, RECENT_CHARS)}`)
      .join('\n');

    return `${summaryPart}${recentHistory}\nUser: ${message}`;
  }
}
