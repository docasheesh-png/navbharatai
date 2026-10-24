/** Public failure boundary: no upstream provider identity, diagnostics, cost, or credentials. */
export const PUBLIC_BUILD_ENGINE_UNAVAILABLE = 'The build engine is temporarily unavailable. Please try again shortly.';
export class PublicBuildEngineError extends Error {
  constructor() {
    super(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    this.name = 'Error';
    this.stack = `Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`;
  }
}
