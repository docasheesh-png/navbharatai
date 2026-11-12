export type SequentialProviderAttempt<T> = (signal: AbortSignal) => Promise<T>;

/**
 * Try providers in order and stop at the first result. Unlike Promise.any/racing, no later
 * provider is started while an earlier provider is still running, avoiding speculative spend.
 */
export async function runSequentialProviderFallback<T>(
  providers: readonly SequentialProviderAttempt<T>[],
  onError?: (error: unknown, index: number) => void,
  signal?: AbortSignal,
): Promise<T | null> {
  for (let index = 0; index < providers.length; index += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error('Provider fallback aborted');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const result = await providers[index](controller.signal);
      if (signal?.aborted) throw signal.reason ?? new Error('Provider fallback aborted');
      if (result !== null && result !== undefined) return result;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      onError?.(error, index);
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  return null;
}
