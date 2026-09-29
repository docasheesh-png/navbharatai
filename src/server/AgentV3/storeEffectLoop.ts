// AgentV3 — AN EFFECT THAT DEPENDS ON THE WHOLE STORE AND WRITES TO IT LOOPS FOREVER (autopsy 6a4a799f).
//
// 🔴 THE FINDING. "Blue Berry", a music app, rendered for the first time at 809 s — as its own error
// screen. React had stopped it with "Maximum update depth exceeded". The cause, in the model's own words
// once it found it (twenty-two minutes in): "the `useEffect` that initializes the store depended on the
// entire `store` object (`[store]`). Since `useMusicStore()` returns a new object reference on every
// render, the effect fired after every render, called `store.init()`, which called `set()` and
// triggered another render — an infinite loop." It fixed that file; the same shape in `PlayerBar` then
// kept the app on its error screen and the build ended RED.
//
// The shape is mechanical and deterministic, so it is caught the moment the file is WRITTEN, while the
// model still holds it — the same place `writeTimeTypecheck` and the Rules-of-Hooks note speak
// (ToolDispatcher.writeSteeringNotes). A zustand hook called with NO selector (`const store =
// useMusicStore()`) returns the whole state, which is a new object after every `set()`; an effect that
// lists that object in its dependencies AND calls one of its actions re-runs after its own write.
//
// ⚠️ PRECISION-FIRST: all three must hold — a `use…Store()` call with no argument bound to a name, an
// effect whose dependency list holds that bare name (not `store.x`), and a `name.method(` call inside the
// effect. An effect that only READS the store does not loop and is never flagged. A note is an aid: it
// appends a sentence to a tool result, never blocks or changes a write.
//
// PURE — no I/O, no model call, no clock. Never throws.

export interface StoreEffectLoop {
  file: string;
  line: number;
  /** The variable holding the whole store, e.g. `store`. */
  name: string;
  /** The hook it came from, e.g. `useMusicStore`. */
  hook: string;
  /** The action the effect calls on it, e.g. `init`. */
  action: string;
}

const REACT_SOURCE = /\.(t|j)sx?$/;
const TEST_FILE = /(^|\/)__(tests?|mocks?)__\/|\.(test|spec)\.[jt]sx?$/i;
const WHOLE_STORE_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(use[A-Z][\w$]*Store|useStore)\s*\(\s*\)/g;
const EFFECT_CALL = /\b(?:React\.)?(useEffect|useLayoutEffect)\s*\(/g;

/** Kill switch. `off` restores the pre-2026-09-29 behaviour exactly: no note, ever. */
export function storeLoopNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_STORE_LOOP_NOTE ?? '').trim().toLowerCase() !== 'off';
}

/**
 * The index just past the parenthesis that closes the one opened at `open` (which must point at `(`),
 * skipping strings, template literals and comments. -1 when unbalanced.
 */
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === ')' ? i + 1 : -1;
    }
  }
  return -1;
}

/** The effect's dependency array text (between the last top-level `[` … `]`), or null when it has none. */
function dependencyList(args: string): string | null {
  const trimmed = args.replace(/\s+$/, '');
  if (!trimmed.endsWith(']')) return null;
  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const c = trimmed[i];
    if (c === ']') depth++;
    else if (c === '[') { depth--; if (depth === 0) return trimmed.slice(i + 1, trimmed.length - 1); }
  }
  return null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every effect in one file that depends on a whole store and calls one of its actions. PURE. */
export function findStoreEffectLoops(path: string, content: string): StoreEffectLoop[] {
  try {
    if (typeof path !== 'string' || typeof content !== 'string') return [];
    if (!REACT_SOURCE.test(path) || TEST_FILE.test(path)) return [];
    if (!/Store\s*\(\s*\)/.test(content) || !/Effect\s*\(/.test(content)) return [];
    const stores = new Map<string, string>();
    for (const m of content.matchAll(WHOLE_STORE_BINDING)) stores.set(m[1], m[2]);
    if (stores.size === 0) return [];

    const out: StoreEffectLoop[] = [];
    for (const m of content.matchAll(EFFECT_CALL)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = closingParen(content, open);
      if (close < 0) continue;
      const args = content.slice(open + 1, close - 1).replace(/\s+$/, '');
      const deps = dependencyList(args);
      if (deps === null) continue;
      const depNames = deps.split(',').map((d) => d.trim()).filter(Boolean);
      for (const [name, hook] of stores) {
        if (!depNames.includes(name)) continue;
        const body = args.slice(0, args.length - deps.length - 2);
        const call = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`).exec(body);
        if (!call) continue;
        out.push({ file: path, line: content.slice(0, m.index ?? 0).split('\n').length, name, hook, action: call[1] });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** The steering sentence for the files just written, or `''`. PURE. */
export function storeEffectLoopNote(files: Record<string, string>, env: NodeJS.ProcessEnv = process.env): string {
  if (!storeLoopNoteEnabled(env)) return '';
  const found: StoreEffectLoop[] = [];
  for (const [p, c] of Object.entries(files ?? {})) found.push(...findStoreEffectLoops(p, c));
  if (found.length === 0) return '';
  const lines = found.slice(0, 4).map((f) =>
    `  • ${f.file}:${f.line}: \`const ${f.name} = ${f.hook}()\` is the WHOLE store — a new object after every state change — and this effect lists \`${f.name}\` as a dependency while calling \`${f.name}.${f.action}()\`.`);
  const f0 = found[0];
  return (
    `\n⚠️ RENDER LOOP — FIX THIS NOW (React stops it with "Maximum update depth exceeded" and the app shows its error screen):\n${lines.join('\n')}\n`
    + `  The effect changes the store, the store change re-runs the effect, forever. Select only what you use — `
    + `\`const ${f0.action} = ${f0.hook}((s) => s.${f0.action})\` — and depend on that, then re-write the file.`
  );
}
