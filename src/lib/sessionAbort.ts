/** Auth SDK persistence can hang on native. Bound the whole wait, not just the later fetch. */
export function withSessionAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Session request timed out', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
