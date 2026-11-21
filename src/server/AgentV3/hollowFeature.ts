// AgentV3 — A SCREEN THAT RENDERS NOTHING IS NOT A FEATURE (failedbr #745, queue Q-3204).
//
// THE EVIDENCE. To silence the type-checker, the builder wrote
//
//     export default function ProfilePage() { return null; }
//     export function useSocial() { return {}; }
//
// The engine wired the null page into the router, and the closing summary told the user the app had "profile
// pages with follow/unfollow". Nothing on that route ever painted a pixel. fakeFeatureScan.ts reads features that
// PRETEND (a login with its password in the code), the claim audit reads labels the source does not contain —
// and both were blind here, because "Profile" IS in the source: as the name of a component that returns nothing.
//
// THE CLASS: a stub written to make the compiler quiet is shipped as the feature it stands in for. This module
// reads the SHAPE of that stub:
//   • a screen — a component whose whole body is `return null` (or `=> null`), that is routed
//     (`element={<X />}`, `component={X}`, `element: <X />`) or is named like one (…Page / …Screen / …View);
//   • a hook — `useX()` whose whole body returns `{}` or `[]`, that some other module calls.
// A component with ANY other statement (an effect, a redirect) is not matched: `return null` after work is a
// real pattern. PURE — no I/O. Three readers: the builder hears it while the file is open (`hollowFeatureWriteNote`),
// the build report records it, and the claim audit contradicts a summary that names it as delivered.

export interface HollowFeature {
  kind: 'screen' | 'hook';
  name: string;
  file: string;
  /** The words a summary would use for it: `ProfilePage` → ['profile'], `useSocialFeed` → ['social', 'feed']. */
  words: string[];
}

const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/i;
const NOT_APP_RE = /(^|[\\/])(?:__mocks__|mocks?|tests?|__tests__|e2e|node_modules|dist|build|coverage)([\\/]|$)|\.(?:test|spec|stories)\.|\.d\.ts$/i;

const TYPE_ANN = String.raw`(?::\s*[^{=;]{1,120})?`;
const PARAMS = String.raw`\([^()]{0,200}\)`;
/** `function Name(...) { return null; }` — the whole body. */
const NULL_FUNCTION = new RegExp(String.raw`\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*${PARAMS}\s*${TYPE_ANN}\{\s*return\s+null\s*;?\s*\}`, 'g');
/** `const Name = (...) => null` / `=> { return null; }`. */
const NULL_ARROW = new RegExp(String.raw`\bconst\s+([A-Z][A-Za-z0-9_]*)\s*${TYPE_ANN}=\s*${PARAMS}\s*${TYPE_ANN}=>\s*(?:null\b|\{\s*return\s+null\s*;?\s*\})`, 'g');
/** `function useX(...) { return {}; }` / `return [];`. */
const EMPTY_HOOK_FUNCTION = new RegExp(String.raw`\bfunction\s+(use[A-Z][A-Za-z0-9_]*)\s*${PARAMS}\s*${TYPE_ANN}\{\s*return\s+(?:\{\s*\}|\[\s*\])(?:\s+as\s+[^;}]{1,80})?\s*;?\s*\}`, 'g');
/** `const useX = (...) => ({})` / `=> []` / `=> { return {}; }`. */
const EMPTY_HOOK_ARROW = new RegExp(String.raw`\bconst\s+(use[A-Z][A-Za-z0-9_]*)\s*${TYPE_ANN}=\s*${PARAMS}\s*${TYPE_ANN}=>\s*(?:\(\s*\{\s*\}\s*\)|\[\s*\]|\{\s*return\s+(?:\{\s*\}|\[\s*\])\s*;?\s*\})`, 'g');
const SCREEN_NAME = /(?:Page|Screen|View)$/;

/** `ProfilePage` → ['profile']; `useSocialFeed` → ['social', 'feed']. Words under four letters say nothing. */
export function featureWords(name: string): string[] {
  const core = name.replace(/^use(?=[A-Z])/, '').replace(/(?:Page|Screen|View|Component)$/, '');
  return core.split(/(?<=[a-z0-9])(?=[A-Z])/).map((w) => w.toLowerCase()).filter((w) => w.length >= 4);
}

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function matchesOf(re: RegExp, text: string): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

function isRouted(name: string, project: string): boolean {
  const n = name.replace(/[$]/g, '\\$&');
  return new RegExp(String.raw`element\s*[=:]\s*\{?\s*<\s*${n}\b|component\s*[=:]\s*\{?\s*${n}\b|Component\s*:\s*${n}\b`).test(project);
}

/** Every hollow screen and hook in the project. Judged over the WHOLE project (a router lives in another file). */
export function findHollowFeatures(files: Readonly<Record<string, string>>): HollowFeature[] {
  const entries = Object.entries(files ?? {}).filter(([p, c]) => SOURCE_RE.test(p) && !NOT_APP_RE.test(p) && typeof c === 'string');
  const cleaned = entries.map(([p, c]) => [p, withoutComments(c)] as const);
  const project = cleaned.map(([, c]) => c).join('\n');
  const out: HollowFeature[] = [];
  for (const [file, text] of cleaned) {
    for (const name of [...matchesOf(NULL_FUNCTION, text), ...matchesOf(NULL_ARROW, text)]) {
      if (out.some((h) => h.name === name)) continue;
      if (SCREEN_NAME.test(name) || isRouted(name, project)) out.push({ kind: 'screen', name, file, words: featureWords(name) });
    }
    for (const name of [...matchesOf(EMPTY_HOOK_FUNCTION, text), ...matchesOf(EMPTY_HOOK_ARROW, text)]) {
      if (out.some((h) => h.name === name)) continue;
      const called = cleaned.some(([f, c]) => f !== file && new RegExp(String.raw`\b${name}\s*\(`).test(c));
      if (called) out.push({ kind: 'hook', name, file, words: featureWords(name) });
    }
  }
  return out;
}

/** The build-report line. '' when there is nothing hollow. */
export function hollowFeatureReport(found: readonly HollowFeature[]): string {
  if (!found.length) return '';
  const list = found.slice(0, 8).map((h) => `${h.name} (${h.file})`).join(', ');
  return `${found.length} part(s) of the app are empty stubs — a screen that renders nothing or a hook that returns nothing: ${list}${found.length > 8 ? ` and ${found.length - 8} more` : ''}. They compile, but the feature they stand for is not built.`;
}

/**
 * For the builder, with the file still open. Judged on this one file: a `…Page`/`…Screen` returning null, or a
 * `useX` returning `{}`/`[]`. '' when clean. PURE.
 */
export function hollowFeatureWriteNote(file: string, content: string): string {
  if (typeof content !== 'string' || !content || !SOURCE_RE.test(file) || NOT_APP_RE.test(file)) return '';
  const text = withoutComments(content);
  const screens = [...matchesOf(NULL_FUNCTION, text), ...matchesOf(NULL_ARROW, text)].filter((n) => SCREEN_NAME.test(n));
  const hooks = [...matchesOf(EMPTY_HOOK_FUNCTION, text), ...matchesOf(EMPTY_HOOK_ARROW, text)];
  const names = [...new Set([...screens, ...hooks])];
  if (!names.length) return '';
  return `\n\n⛔ EMPTY STUB — ${file}: ${names.join(', ')} ${names.length === 1 ? 'returns' : 'return'} nothing. A stub that only quiets the type-checker is not the feature. `
    + 'Build the real screen/hook now, or take it out of the router and do NOT name it as delivered in your final message.\n';
}
