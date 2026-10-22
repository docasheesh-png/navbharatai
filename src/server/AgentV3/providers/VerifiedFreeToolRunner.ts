/** Native builder transcript adapter. Only the live registry may dispatch inference. */
import { assertAiAvailable } from '../../lib/aiMaintenance';
import { strictFreeToolTurn } from '../../AI/LiveRegistry/runtime';
import type { RunTurnParams, TurnResult, TurnRunner, TurnUsage } from '../ClaudeClient';
import { parseOpenAiCompletion, toolDefsToOpenAI, transcriptToOpenAI } from './OpenAiToolAdapter';
import { throwIfStopped } from '../stopSignal';

export interface VerifiedFreeRunnerOptions {
  onProviderUsed?: (provider: string, previous: string[]) => void;
  onTurnComplete?: (provider: string, usage: TurnUsage, model?: string, cachedInput?: number) => void;
}
export class VerifiedFreeToolRunner implements TurnRunner {
  readonly plannedModel = 'VERIFIED_FREE_REGISTRY';
  constructor(private readonly options: VerifiedFreeRunnerOptions = {}, private readonly dispatch = strictFreeToolTurn) {}
  async runTurn(params: RunTurnParams): Promise<TurnResult> {
    await assertAiAvailable();
    throwIfStopped(params.signal);
    const abort = new AbortController();
    const stop = () => abort.abort();
    params.signal?.addEventListener('abort', stop, { once: true });
    if (params.signal?.aborted) abort.abort();
    const remaining = params.deadlineAt === undefined ? null : params.deadlineAt - Date.now();
    if (remaining !== null && remaining <= 0) { params.signal?.removeEventListener('abort', stop); throw new Error('Build call deadline reached.'); }
    const timer = remaining === null ? null : setTimeout(stop, remaining);
    try {
      const answer = await this.dispatch({
        messages: transcriptToOpenAI(params.messages, params.system),
        tools: toolDefsToOpenAI(params.tools),
        maxOutputTokens: params.maxTokens ?? 8192,
        signal: abort.signal,
      });
      throwIfStopped(params.signal);
      const result = parseOpenAiCompletion({
        model: answer.model,
        choices: [{ message: { role: 'assistant', content: answer.content || null,
          tool_calls: answer.toolCalls.map(t => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })),
        }, finish_reason: answer.finishReason }],
        ...(answer.usage ? { usage: { prompt_tokens: answer.usage.inputTokens, completion_tokens: answer.usage.outputTokens } } : {}),
      });
      result.usage.pricingProof = answer.pricingProof;
      result.selectedMaxOutputTokens = answer.selectedMaxOutputTokens;
      result.usage.selectedMaxOutputTokens = answer.selectedMaxOutputTokens;
      // Observation errors must never buy a second inference call or discard a completed answer.
      try { this.options.onProviderUsed?.('OPENROUTER', []); } catch { /* observation */ }
      try { this.options.onTurnComplete?.('OPENROUTER', result.usage, result.model, result.usage.cacheReadInputTokens); } catch { /* observation */ }
      // Tool turns are buffered; do not advertise token streaming that did not happen.
      if (result.text) params.onText?.(result.text);
      return result;
    } finally {
      if (timer !== null) clearTimeout(timer);
      params.signal?.removeEventListener('abort', stop);
      abort.abort();
    }
  }
}
