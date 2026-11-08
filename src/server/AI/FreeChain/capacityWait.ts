/** Bounded wakeups for physical FreeChain slot releases; no provider retries or quota grants. */
let revision = 0;
const waiters = new Set<() => void>();
export const capacityRevision = () => revision;
export function notifyCapacityReleased(): void {
  revision++;
  for (const wake of [...waiters]) wake();
}
export function waitForCapacity(observed: number, deadline: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || Date.now() >= deadline || waiters.size >= 64) return Promise.resolve(false);
  if (revision !== observed) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return; settled = true;
      clearTimeout(timer); waiters.delete(wake); signal?.removeEventListener('abort', abort);
      resolve(available && !signal?.aborted && Date.now() < deadline);
    };
    const wake = () => finish(true), abort = () => finish(false);
    const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
    waiters.add(wake); signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort(); else if (revision !== observed) wake();
  });
}
