/** Track this handler's asynchronous source saves before authorizing another queued module window. */
export function createBuildSourcePublication() {
  const pending = new Set<Promise<unknown>>();
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let uncertain = false;
  const close = (): void => { closed = true; clearTimeout(scheduled); scheduled = undefined; };
  const track = <T>(work: Promise<T>): Promise<T> => {
    if (closed) uncertain = true; // A newly issued post-close write cannot be covered by an earlier join snapshot.
    const observed = work.then((value) => {
      const status = typeof value === 'string' ? value : (value as { status?: unknown } | null)?.status;
      if (status === 'failed' || status === 'partial' || status === 'no-store' || status === 'skipped-unconfirmed') uncertain = true;
    }, () => { uncertain = true; });
    pending.add(observed);
    void observed.finally(() => pending.delete(observed));
    return work;
  };
  return {
    track,
    uncertain: (): boolean => uncertain,
    issue<T>(save: () => Promise<T>): Promise<T | undefined> {
      if (closed) { uncertain = true; return Promise.resolve(undefined); }
      return track(save());
    },
    cancelScheduled(): void { clearTimeout(scheduled); scheduled = undefined; },
    schedule(flush: () => void, delayMs: number): void {
      clearTimeout(scheduled);
      if (closed) { uncertain = true; return; }
      scheduled = setTimeout(() => { scheduled = undefined; if (!closed) flush(); }, delayMs);
    },
    close,
    async join(timeoutMs = 15_000): Promise<boolean> {
      close();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const drained = await Promise.race([
          Promise.all([...pending]).then(() => true),
          new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
        ]);
        return drained && !uncertain;
      } finally { clearTimeout(timer); }
    },
  };
}
