import { AIRouterManager } from './AIRouterManager';
import type { TraceContext } from '../../../server';

export class UniversalAIRouter {
  private readonly TIMEOUT_MS = 90000; // 90s total timeout per request

  async route(
    message: string,
    history: any[] = [],
    tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip' = 'navbharat',
    traceContext?: TraceContext,
    systemPrompt?: string,
  ): Promise<string> {
    const isPro = tier === 'vishwakarma-pro' || tier === 'vip';
    const ns = isPro ? 'pro' : 'free';
    const router = AIRouterManager.getRouter(ns);

    console.log(`[UNIVERSAL_ROUTER] tier=${tier} ns=${ns} hasSystemPrompt=${!!systemPrompt}`);

    // Build prompt with history context
    const fullPrompt = this.buildPrompt(message, history);

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Request timeout after ${this.TIMEOUT_MS}ms`)), this.TIMEOUT_MS)
      );
      const { response, telemetry } = await Promise.race([
        router.route(fullPrompt, systemPrompt),
        timeout,
      ]);
      console.log(`[UNIVERSAL_ROUTER] Success via ${telemetry.provider} in ${telemetry.latency}ms`);
      return response.content;
    } catch (e: any) {
      console.error('[UNIVERSAL_ROUTER] All providers exhausted:', e.message);
      return 'Abhi AI service thodi der ke liye busy hai. Kripya 1-2 minute mein dobara try karein. 🙏';
    }
  }

  private buildPrompt(message: string, history: any[]): string {
    if (!history || history.length === 0) return message;
    const historyText = history
      .slice(-10) // last 10 turns for context
      .map((m: any) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${String(m.text || m.content || '').slice(0, 500)}`)
      .join('\n');
    return `${historyText}\nUser: ${message}`;
  }
}
