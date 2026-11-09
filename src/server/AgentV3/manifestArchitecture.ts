import { requiresSingleHtml } from '../../lib/singleHtmlConstraint';

/** Only user-authored constraints bind the manifest. A planner's invented single-file policy does not. */
export function manifestArchitectureProblem(paths: readonly string[], originalRequest: string): string | null {
  if (!requiresSingleHtml(originalRequest)) return null;
  const runtime = paths.filter((path) => /\.(?:json|html?|[cm]?[jt]sx?|css|scss|sass|less|svg|png|jpe?g|webp|gif|woff2?|mp[34]|webm)$/i.test(path));
  return runtime.length === 1 && /\.html?$/i.test(runtime[0]) ? null
    : 'architecture_mismatch: the user requested one HTML file, but the manifest splits the app across runtime files; use the original constraint rather than spending on this contradictory plan';
}
