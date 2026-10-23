import { assertFreeAnswerDispatch } from '../../lib/freeAnswerQuotaContext';
/** Tiny server-only boundary, separate from runtime to avoid provider/router import cycles. */
import { AsyncLocalStorage } from 'node:async_hooks';
const selection = new AsyncLocalStorage<boolean>();
export class InferenceGatewayTerminalError extends Error {
  readonly code = 'INFERENCE_GATEWAY_TERMINAL';
  readonly status = 503;
  constructor(readonly reason: string) {
    super('The selected AI service is unavailable. Please try again later.');
    this.name = 'InferenceGatewayTerminalError';
  }
}
/** Selection is monotonic for descendants; it is never an authorization to dispatch. */
export function runWithGatewaySelection<T>(selected: boolean, run: () => T): T {
  return selection.run(selection.getStore() === true || selected, run);
}
export function isGatewayDispatchSelected(): boolean { return selection.getStore() === true; }
export function assertNoUnclaimedGatewayDispatch(capability: string): void {
  assertFreeAnswerDispatch();
  // Image routes retain their own existing quota/payment policy and were expressly excluded.
  if (capability === 'image-generation' || capability === 'image-edit' || capability === 'image-enhancement') return;
  if (selection.getStore() === true) throw new InferenceGatewayTerminalError('unclaimed-legacy-dispatch');
}
