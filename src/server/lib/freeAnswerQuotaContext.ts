/** Logical user-turn fencing, independent from physical provider occupancy and accounting. */
import { AsyncLocalStorage } from 'node:async_hooks';
interface Context { signal: AbortSignal; assertActive: () => void }
const context = new AsyncLocalStorage<Context>();
export function runWithFreeAnswerContext<T>(value: Context, run: () => T): T { return context.run(value, run); }
export function assertFreeAnswerDispatch(): void { context.getStore()?.assertActive(); }
export function currentFreeAnswerSignal(): AbortSignal | undefined { return context.getStore()?.signal; }
