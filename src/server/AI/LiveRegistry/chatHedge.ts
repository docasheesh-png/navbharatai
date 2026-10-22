import { FreeRoutingError, type FreeTextRequest, type FreeTextResult } from './dispatcher';

/** Internal only: dispatcher owns eligibility, durable admission and pricing proofs. */
export type SingleChatAttempt = (input: FreeTextRequest & { maxAttempts: 1; excludeModelIds: Set<string> }) => Promise<FreeTextResult>;
export interface ChatHedgeOptions { delayMs?: number; timeoutMs?: number }
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
function mustStop(error: unknown): boolean {
  return error instanceof FreeRoutingError && (error.code === 'FREE_BILLING_ANOMALY' || [400, 401, 402, 403, 413, 422].includes(error.status));
}
/**
 * Plain chat only, never tool turns. Two dispatches at most, one attempt each.
 * First meaningful text locks the winner: a later failure is surfaced, never
 * replaced with a different answer after partial output. Cancellation is best
 * effort at the provider and does not promise a quota refund.
 */
export function hedgeFreeChat(dispatch: SingleChatAttempt, input: FreeTextRequest, options: ChatHedgeOptions = {}): Promise<FreeTextResult> {
  const delayMs = bounded(options.delayMs, 1500, 0, 10000);
  const timeoutMs = bounded(options.timeoutMs, 45000, 1, 120000);
  if (input.signal?.aborted) return Promise.reject(new FreeRoutingError('CHAT_ABORTED'));
  return new Promise<FreeTextResult>((resolve, reject) => {
    const controllers = [new AbortController(), new AbortController()];
    const excluded = new Set<string>();
    const finished = [false, false];
    const prefix = ['', ''];
    let started = 0;
    let winner: number | undefined;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(hedgeTimer); clearTimeout(deadline);
      input.signal?.removeEventListener('abort', abort);
      for (const controller of controllers) controller.abort();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const abort = () => fail(new FreeRoutingError('CHAT_ABORTED'));
    const select = (index: number) => {
      if (winner !== undefined) return;
      winner = index; clearTimeout(hedgeTimer); controllers[1 - index].abort();
    };
    const chunk = (index: number, text: string) => {
      if (settled || controllers[index].signal.aborted || (winner !== undefined && winner !== index)) return;
      if (winner === undefined) {
        prefix[index] += text;
        if (!prefix[index].trim()) {
          if (prefix[index].length > 16384) {
            controllers[index].abort(); throw new FreeRoutingError('EMPTY_CHAT_PREFIX_TOO_LARGE');
          }
          return;
        }
        select(index);
        const initial = prefix[index]; prefix[index] = '';
        try { input.onChunk?.(initial); } catch (error) { fail(error); throw error; }
      } else {
        try { input.onChunk?.(text); } catch (error) { fail(error); throw error; }
      }
    };
    const start = (index: number) => {
      if (settled || winner !== undefined || started > index) return;
      started = index + 1;
      // Do not forward arbitrary tool envelopes or caller-controlled budgets.
      const attempt = {
        prompt: input.prompt, systemPrompt: input.systemPrompt, maxOutputTokens: input.maxOutputTokens,
        signal: controllers[index].signal, onChunk: (text: string) => chunk(index, text),
        maxAttempts: 1 as const, excludeModelIds: excluded,
      };
      Promise.resolve().then(() => {
        if (settled || controllers[index].signal.aborted) throw new FreeRoutingError('CHAT_ABORTED');
        return dispatch(attempt);
      }).then(result => {
        finished[index] = true;
        if (settled || (winner !== undefined && winner !== index)) return;
        if (!result.content.trim() || result.toolCalls.length) throw new FreeRoutingError('INVALID_CHAT_RESPONSE');
        if (winner === undefined) {
          select(index);
          try { input.onChunk?.(result.content); } catch (error) { fail(error); return; }
        }
        settled = true; cleanup(); resolve(result);
      }).catch(error => {
        finished[index] = true;
        if (settled) return;
        if (mustStop(error) || winner === index) { fail(error); return; }
        if (winner !== undefined) return;
        if (started === 1) { clearTimeout(hedgeTimer); start(1); }
        else if (finished[0] && finished[1]) fail(new FreeRoutingError('ALL_FREE_MODELS_FAILED'));
      });
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) { abort(); return; }
    deadline = setTimeout(() => fail(new FreeRoutingError('CHAT_DEADLINE_EXCEEDED')), timeoutMs);
    hedgeTimer = setTimeout(() => start(1), delayMs);
    start(0);
  });
}
