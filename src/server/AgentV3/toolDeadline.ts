import { AsyncLocalStorage } from 'node:async_hooks';

const toolSignals = new AsyncLocalStorage<AbortSignal>();

/** Run `fn` so every write and command under it can see `signal` via `currentToolSignal`. */
export function runWithToolSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return toolSignals.run(signal, fn);
}

export function currentToolSignal(): AbortSignal | undefined {
  return toolSignals.getStore();
}

/** Emergency valve. Default on. `AGENTV3_LAPSED_GUARD=off` lets a late write through. */
export function lapsedGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_LAPSED_GUARD ?? '').trim().toLowerCase() !== 'off';
}

export const LAPSED_WRITE_MESSAGE = 'LAPSED: the tool ran past its deadline; this late write was discarded';
