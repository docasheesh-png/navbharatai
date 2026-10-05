// AgentV3 — the file that builds a feature the user asked for is not the build's to delete (Q-118,
// admin-approved option (b) 2026-10-05).
//
// 🔴 THE GAP (autopsy baa0b3c7, PROGRESS L65379 / L65467). Every delete guard in the bash tool protects
// something structural: a directory wipe, a bulk delete, a runtime manifest, a module other files still
// import, a file the user put in the workspace. A single feature component that nothing imports yet — or
// that the model has just un-imported from `App.tsx` on its way to "cleaning up" — passed all of them.
// `rm src/components/Cart.tsx` on a shop the user asked to have a cart is one honest-looking command and
// a missing feature.
//
// THE RULE: refuse a single source-file delete when the file's own name says it builds something the
// user AFFIRMATIVELY asked for (`isAffirmativelyRequested` — "no cart" and "remove the cart" are not
// requests for one), and no other file in the project carries that name. Every other delete is allowed:
//   • a demo or stale file (`Counter.tsx`, `OldHeader.tsx`) names nothing the user asked for;
//   • a replacement written FIRST (`CartPage.tsx` while `Cart.tsx` exists) leaves the feature a home;
//   • the current request asking to remove it ("remove the wishlist", "delete Wishlist.tsx") wins.
// Refusing is the safe direction: a wrongly refused delete costs the model one sentence; a wrong delete
// removes a feature the user asked for and is usually noticed only after the build says "done".
// Kill switch AGENTV3_FEATURE_FILE_GUARD=off. PURE — no I/O.

import { isAffirmativelyRequested } from './featureRequest';
import { requestAsksToRemove } from './userFileGuard';

/** Kill switch `AGENTV3_FEATURE_FILE_GUARD=off`; default on. */
export function featureFileGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_FEATURE_FILE_GUARD ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Name parts that say how a file is organised, not what it does. A file called `Page.tsx` or
 * `useStore.ts` names no feature, so these never protect anything.
 */
const STRUCTURAL = new Set([
  'app', 'apps', 'page', 'pages', 'component', 'components', 'index', 'main', 'layout', 'layouts', 'root',
  'util', 'utils', 'helper', 'helpers', 'hook', 'hooks', 'use', 'type', 'types', 'style', 'styles', 'css',
  'test', 'tests', 'spec', 'demo', 'example', 'sample', 'counter', 'hello', 'world', 'old', 'new', 'temp',
  'tmp', 'copy', 'backup', 'legacy', 'unused', 'stub', 'placeholder', 'screen', 'screens', 'view', 'views',
  'section', 'container', 'wrapper', 'provider', 'context', 'store', 'service', 'services', 'api', 'lib',
  'config', 'constants', 'data', 'mock', 'mocks', 'item', 'items', 'list', 'card', 'cards', 'button',
  'modal', 'form', 'widget', 'base', 'common', 'shared', 'core', 'default', 'basic', 'simple', 'custom',
  'header', 'footer', 'navbar', 'nav', 'sidebar', 'icon', 'icons', 'logo', 'tsx', 'jsx',
]);

/** The feature words a file's NAME carries: `ShoppingCart.tsx` → shopping, cart. Lower-case, singular. */
export function featureWordsOfPath(path: string): string[] {
  const base = String(path ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '');
  const parts = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3);
  const out: string[] = [];
  for (const w of parts) {
    const one = singular(w);
    if (STRUCTURAL.has(w) || STRUCTURAL.has(one)) continue;
    if (!out.includes(one)) out.push(one);
  }
  return out;
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function wordPattern(word: string): RegExp {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stemmed = word.endsWith('y') ? `(?:${esc}|${esc.slice(0, -1)}ies)` : `${esc}(?:s|es)?`;
  return new RegExp(`\\b${stemmed}\\b`, 'i');
}

export interface ProtectedFeatureFile {
  /** The feature word the file's name carries and a request asked for. */
  word: string;
  /** The request that asked for it, cut short for the message. */
  askedIn: string;
}

/**
 * Should deleting `target` be refused? `requests` is newest first: `requests[0]` is the request this
 * build answers, the rest are earlier turns of the same session. `projectFiles` is every file the project
 * holds right now. Returns the reason to refuse, or null to allow.
 */
export function protectedFeatureFileDeletion(
  target: string,
  requests: ReadonlyArray<string | null | undefined>,
  projectFiles: Iterable<string>,
): ProtectedFeatureFile | null {
  const words = featureWordsOfPath(target);
  if (words.length === 0) return null;
  const texts = requests.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
  if (texts.length === 0) return null;
  const current = texts[0];
  // The current request asking to delete this file by name wins outright.
  if (requestAsksToRemove(current, target)) return null;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  const self = norm(target);
  const others = [...projectFiles].map(norm).filter((p) => p && p !== self);
  for (const word of words) {
    const re = wordPattern(word);
    // Mentioned in THIS request, but never affirmatively ("no cart", "remove the cart"): the user's
    // current intent is that it goes, whatever an earlier turn asked for.
    if (re.test(current) && !isAffirmativelyRequested(current, re)) return null;
    const asked = texts.find((t) => isAffirmativelyRequested(t, re));
    if (!asked) continue;
    // Another file still carries the feature (a replacement written first): the feature keeps a home.
    if (others.some((p) => featureWordsOfPath(p).includes(word))) continue;
    return { word, askedIn: asked.replace(/\s+/g, ' ').trim().slice(0, 120) };
  }
  return null;
}

/** The refusal the model receives. */
export function protectedFeatureFileMessage(target: string, hit: ProtectedFeatureFile): string {
  return (
    `[GOVERNANCE BLOCKED] Refused to delete "${target}" — it is the only file that builds "${hit.word}", which ` +
    `the user asked for ("${hit.askedIn}"). Deleting it removes a feature they requested. If it is broken, fix ` +
    `it in place. If you are replacing it, write the new file first — then this delete is allowed. If the user ` +
    `wants it gone, say so in your reply and let them ask for it.`
  );
}
