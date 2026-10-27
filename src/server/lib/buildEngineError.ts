/** Public failure boundary: no upstream provider identity, diagnostics, cost, or credentials. */
export const PUBLIC_BUILD_ENGINE_UNAVAILABLE = 'The build engine is temporarily unavailable. Please try again shortly.';
/** Distinct from UNAVAILABLE: the turn's own wall clock ended — not a claim the whole platform is down. */
export const PUBLIC_BUILD_ENGINE_TIMEOUT = 'The build step timed out. Please try again shortly.';

/**
 * Internal, non-serialized classification for logs/diagnostics. Never put on the Error as an own
 * property — publicBoundary tests require JSON/SSE of PublicBuildEngineError to stay supplier-free
 * and property-names to stay {message,name,stack} only.
 */
export type PublicBuildEngineSafeReason =
  | 'turn_timeout'
  | 'attempts_exhausted'
  | 'terminal_fold'
  | 'policy_refusal'
  | 'misconfigured';

const safeReasons = new WeakMap<object, PublicBuildEngineSafeReason>();

export class PublicBuildEngineError extends Error {
  constructor(message: string = PUBLIC_BUILD_ENGINE_UNAVAILABLE) {
    super(message);
    this.name = 'Error';
    this.stack = `Error: ${message}`;
  }
}

export function publicBuildEngineSafeReason(error: unknown): PublicBuildEngineSafeReason | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? safeReasons.get(error)
    : undefined;
}

/** Construct the public error with an optional internal reason tag (WeakMap — not enumerable). */
export function publicBuildEngineError(reason: PublicBuildEngineSafeReason = 'terminal_fold'): PublicBuildEngineError {
  const message = reason === 'turn_timeout' ? PUBLIC_BUILD_ENGINE_TIMEOUT : PUBLIC_BUILD_ENGINE_UNAVAILABLE;
  const error = new PublicBuildEngineError(message);
  safeReasons.set(error, reason);
  return error;
}
