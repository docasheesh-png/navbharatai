// A PARENT'S RE-RENDER IS NOT A RELOAD (admin 2026-10-05: "app mart → instant play app → comment … click kare to
// screen vibrate hoti rehti hai, aisa lagta kuch load ho raha hai, jabki kuch hai hi nahi loading ke liye").
//
// The comments sheet loaded inside `useCallback(…, [appKey, onCounts])`, ran it from `useEffect(…, [load])`, and
// called `onCounts` with the counts it fetched. The parent passes `onCounts` as an inline arrow, so every parent
// render makes a new one — and calling it changed the parent's state. load → onCounts → parent renders → new
// onCounts → new load → the effect runs again → "loading" → fetch → … for ever: the flicker the admin saw, and one
// request to the server per turn of the loop.
//
// THE CLASS: a hook that LOADS (fetches / awaits) and lists a callback PROP in its dependencies while calling it.
// A prop's identity is the parent's business; a load must not depend on it. The fix is to read the callback through
// a ref. This census reads every client hook — an effect directly, or a useCallback an effect depends on — and fails
// on a new one. The three that remain are listed with why each cannot loop; a new entry needs the same proof.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const CLIENT_DIRS = ['src/components', 'src/hooks', 'src/lib', 'src/App.tsx'];

/** Checked by hand: each re-runs harmlessly, and why. */
const PROVEN_SAFE: Record<string, string> = {
  // The only callers pass a React setState setter (App.tsx `setV3FooterApi` / `setAdminFooterApi`), whose identity
  // never changes; the `.then` it carries runs inside a click handler of the published API, not on mount.
  'src/components/agentv3/AgentV3Panel.tsx#onFooterApi': 'stable setState from App.tsx; the load is inside a click handler',
  // Runs once per signed-in user (`tried.current === userId` returns before any work on every later run).
  'src/hooks/useHeldReferralCode.ts#onApplied': 'once-per-user guard before any work',
  // A `message` listener: a new callback re-registers the listener; the save runs only when a message arrives.
  'src/components/agentv3/PreviewSurface.tsx#onFileEdited': 'window message listener, not a load',
};

function files(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const abs = join(ROOT, p);
    if (statSync(abs).isDirectory()) {
      for (const e of readdirSync(abs)) walk(join(p, e));
    } else if (/\.(tsx|ts)$/.test(p) && !/\.test\.|\.d\.ts$/.test(p)) {
      out.push(p);
    }
  };
  for (const d of CLIENT_DIRS) walk(d);
  return out;
}

interface Hook { kind: string; name: string | null; start: number; end: number; deps: string[]; body: string }

/** Every useEffect / useLayoutEffect / useCallback with a literal dependency list, with its body text. */
function hooksOf(src: string): Hook[] {
  const out: Hook[] = [];
  const re = /(?:const\s+(\w+)\s*=\s*)?\buse(Effect|LayoutEffect|Callback)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk to the matching close paren of the hook call.
    let depth = 0; let i = m.index + m[0].length - 1; let end = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const call = src.slice(m.index, end + 1);
    const depsMatch = call.match(/,\s*\[([^\]]*)\]\s*\)$/);
    if (!depsMatch) continue;
    const deps = depsMatch[1].split(',').map((d) => d.trim()).filter(Boolean);
    out.push({ kind: m[2], name: m[1] ?? null, start: m.index, end, deps, body: call });
  }
  return out;
}

const LOADS = /\bfetch\s*\(|\bawait\b|\.then\s*\(/;
const calls = (body: string, name: string) => new RegExp(`\\b${name}\\s*(?:\\?\\.)?\\(`).test(body);

/** The callback props one source's loading effects depend on and call. */
function violationsOf(src: string): string[] {
  const found = new Set<string>();
  {
    const hooks = hooksOf(src);
    // Two components in one file may each have a `load` (AppMartSocial.tsx does): an effect depends on the
    // NEAREST callback of that name declared before it — a map keyed by name alone let the later one win and
    // hid the very bug this census exists for (caught by putting the bug back).
    const callbackBefore = (name: string, at: number): Hook | undefined =>
      hooks.filter((c) => c.kind === 'Callback' && c.name === name && c.start < at).sort((a, b) => b.start - a.start)[0];
    for (const h of hooks) {
      if (h.kind === 'Callback') continue;
      // The effect itself, and every useCallback it depends on (the comments sheet's shape).
      const units = [h, ...h.deps.map((d) => callbackBefore(d, h.start)).filter((x): x is Hook => !!x)];
      for (const u of units) {
        if (!LOADS.test(u.body)) continue;
        for (const dep of u.deps) {
          if (/^on[A-Z]\w*$/.test(dep) && calls(u.body, dep)) found.add(dep);
        }
      }
    }
  }
  return [...found].sort();
}

/** `file#prop` for every effect that loads while depending on a callback prop it calls. */
function violations(): string[] {
  const found: string[] = [];
  for (const f of files()) {
    for (const prop of violationsOf(readFileSync(join(ROOT, f), 'utf8'))) found.push(`${f}#${prop}`);
  }
  return found.sort();
}

describe('a parent re-render never re-runs a load', () => {
  it('no client effect loads while depending on a callback prop it calls (only the proven-safe three remain)', () => {
    const v = violations();
    const unexpected = v.filter((k) => !(k in PROVEN_SAFE));
    expect(unexpected, `A load depends on a callback prop — read it through a ref instead:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('every proven-safe entry still exists, so the list cannot rot into a blanket exemption', () => {
    const v = new Set(violations());
    for (const k of Object.keys(PROVEN_SAFE)) expect(v.has(k), `${k} no longer matches — remove it from PROVEN_SAFE`).toBe(true);
  });

  it('🔴 the App Mart comments sheet reads onCounts through a ref and loads only when the app changes', () => {
    const src = readFileSync(join(ROOT, 'src/components/ide/appMart/AppMartSocial.tsx'), 'utf8');
    const start = src.indexOf('export function CommentsSection');
    const sheet = src.slice(start, src.indexOf('\nexport function', start + 10));
    expect(sheet).toContain('const onCountsRef = useRef(onCounts);');
    expect(sheet).toMatch(/onCountsRef\.current\?\.\(d\.counts\)/);
    expect(sheet).toMatch(/\}, \[appKey\]\);/);
    expect(sheet).not.toMatch(/\[appKey, onCounts\]/);
  });

  it('the census sees the original bug even beside a same-named callback in a later component', () => {
    const buggy = `
      function CommentsSection() {
        const load = useCallback(async () => { const d = await fetchComments(appKey); if (d.counts && onCounts) onCounts(d.counts); }, [appKey, onCounts]);
        useEffect(() => { void load(); }, [load, signedIn]);
      }
      function CommentReportsAdmin() {
        const load = useCallback(() => { fetchCommentReports().then(setRows); }, []);
        useEffect(() => { load(); }, [load]);
      }`;
    expect(violationsOf(buggy)).toEqual(['onCounts']);
  });

  it('the census sees the original bug (a canary, so a census that matches nothing cannot pass)', () => {
    const buggy = `
      const load = useCallback(async () => { const d = await fetchComments(appKey); if (d.counts && onCounts) onCounts(d.counts); }, [appKey, onCounts]);
      useEffect(() => { void load(); }, [load, signedIn]);`;
    const hooks = hooksOf(buggy);
    const cb = hooks.find((h) => h.name === 'load')!;
    expect(cb.deps).toEqual(['appKey', 'onCounts']);
    expect(LOADS.test(cb.body) && calls(cb.body, 'onCounts')).toBe(true);
    expect(hooks.find((h) => h.kind === 'Effect')!.deps).toContain('load');
  });
});
