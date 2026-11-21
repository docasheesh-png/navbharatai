/**
 * A STORE THAT NEVER TELLS REACT IT CHANGED (failedbr #1179, 2026-11-20).
 *
 * The fast lane saved `useMessages.ts` with
 *   `function subscribe(listener) { // we do nothing because state is mutated directly
 *      return () => {}; }`
 * and passed it to `useSyncExternalStore`. React re-renders only when a subscribed listener is called, so a message the
 * user sent was stored and never shown. The shape is exact and its fix is one line, so it is said while the file is open.
 *
 * PRECISION-FIRST: only a `subscribe` whose WHOLE body is comments plus `return () => {}` (or the arrow form
 * `subscribe = () => () => {}`), in a file that calls `useSyncExternalStore`. A real subscription that keeps its listener
 * and calls it later never matches. PURE.
 */

// One level of nested parentheses in the parameter list: `(listener: () => void)`.
const PARAMS = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const COMMENTS = String.raw`(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*`;
const EMPTY_UNSUB = String.raw`\(\s*\)\s*=>\s*\{\s*\}`;
const DEAD_FUNCTION = new RegExp(String.raw`\bfunction\s+subscribe\s*` + PARAMS + String.raw`\s*(?::[^{]+)?\{\s*` + COMMENTS + String.raw`return\s*` + EMPTY_UNSUB + String.raw`\s*;?\s*\}`);
const DEAD_ARROW = new RegExp(String.raw`\bsubscribe\s*[:=]\s*` + PARAMS + String.raw`\s*(?::[^=]+)?=>\s*(?:\{\s*` + COMMENTS + String.raw`return\s*)?` + EMPTY_UNSUB);

/** Does this source hand `useSyncExternalStore` a subscribe that can never notify? PURE. */
export function hasDeadStoreSubscription(source: string): boolean {
  const s = String(source ?? '');
  if (!/\buseSyncExternalStore\s*\(/.test(s)) return false;
  return DEAD_FUNCTION.test(s) || DEAD_ARROW.test(s);
}

/** The write-time note for the files just written, or ''. PURE. */
export function deadStoreSubscriptionNote(files: Readonly<Record<string, string>>): string {
  const hit = Object.entries(files ?? {}).filter(([p, c]) => /\.[jt]sx?$/.test(p) && typeof c === 'string' && hasDeadStoreSubscription(c)).map(([p]) => p);
  if (hit.length === 0) return '';
  return `\n⚠️ ${hit.join(', ')}: \`subscribe\` returns \`() => {}\` and never keeps its listener, so useSyncExternalStore will NEVER `
    + 're-render — what the user adds is stored and not shown. Keep the listener in a Set, call every listener after each change, '
    + 'and return a function that deletes it.';
}
