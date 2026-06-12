import { AIRouterManager } from './AIRouterManager';
import type { TraceContext } from '../../../server';

export class UniversalAIRouter {
  private readonly TIMEOUT_MS = 90000;

  async route(
    message: string,
    history: any[] = [],
    tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip' = 'navbharat',
    traceContext?: TraceContext,
    systemPrompt?: string,
  ): Promise<string> {
    const ns = (tier === 'vishwakarma-pro' || tier === 'vip') ? 'pro' : 'free';
    const router = AIRouterManager.getRouter(ns);
    const fullPrompt = this.buildPrompt(message, history);
    console.log(`[UNIVERSAL_ROUTER] tier=${tier} ns=${ns} promptLen=${fullPrompt.length}`);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.TIMEOUT_MS)
      );
      const { response } = await Promise.race([router.route(fullPrompt, systemPrompt), timeout]);
      return response.content;
    } catch (e: any) {
      console.error('[UNIVERSAL_ROUTER] exhausted:', e.message);
      return 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏';
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
    const ns = (tier === 'vishwakarma-pro' || tier === 'vip') ? 'pro' : 'free';
    const router = AIRouterManager.getRouter(ns);
    const fullPrompt = this.buildPrompt(message, history);
    await router.routeStream(fullPrompt, systemPrompt, onChunk, signal);
  }

  // Context compression: keep last 12 turns, summarise older ones
  private buildPrompt(message: string, history: any[]): string {
    if (!history || history.length === 0) return message;
    const MAX_RECENT = 12;
    let relevant = history;
    if (history.length > MAX_RECENT) {
      const old = history.slice(0, -MAX_RECENT);
      const recent = history.slice(-MAX_RECENT);
      const summary = old
        .map(m => `${m.sender === 'user' ? 'U' : 'A'}: ${String(m.text || m.content || '').slice(0, 200)}`)
        .join(' | ');
      relevant = [
        { sender: 'ai', text: `[Earlier conversation (${old.length} msgs): ${summary}]` },
        ...recent,
      ];
    }
    const historyText = relevant
      .map(m => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${String(m.text || m.content || '').slice(0, 600)}`)
      .join('\n');
    return `${historyText}\nUser: ${message}`;
  }
}
