// GA-16 (roadmap Tier 2C) — memory-leak analyzer: a React useEffect that acquires a long-lived resource
// (setInterval / setTimeout / addEventListener / a subscription) but returns NO cleanup function.
//
// This is the classic React leak: the interval/listener/subscription keeps firing after the component
// unmounts (and on every re-run of the effect), causing memory growth, doubled timers, and "setState on an
// unmounted component" warnings. React runs the function an effect RETURNS as its cleanup — so an effect that
// starts a timer/listener MUST return one that stops it. This flags the effects that don't. ADVISORY only:
// surfaced in `evaluate`, NEVER a readiness blocker (a leak is a quality concern, not a build-breaking
// correctness failure). AST-accurate (ts-morph); PURE; never throws.

export interface EffectLeakIssue {
  kind: 'missing-effect-cleanup';
  file: string;
  line: number;
  /** The leaky setup called without a matching cleanup (e.g. 'setInterval', 'addEventListener'). */
  resource: string;
  detail: string;
}

const CODE_FILE = /\.(?:m?[jt]sx?)$/i;
const EXCLUDE = /(\.test\.|\.spec\.|\.d\.ts$)/;
// Setups that MUST be torn down in an effect's cleanup. (setTimeout is included — it fires after unmount and
// triggers "setState on unmounted" warnings; a cleanup clearTimeout is the correct pattern.)
const LEAKY_SETUPS = new Set<string>(['setInterval', 'setTimeout', 'addEventListener', 'subscribe', 'observe']);
const MAX_ISSUES = 20;

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

/** Flag React useEffect callbacks that acquire a leaky resource but return no cleanup. Advisory. Never throws. */
export async function analyzeEffectCleanup(
  sources: ReadonlyArray<{ path: string; content: string }>,
): Promise<EffectLeakIssue[]> {
  const mod = await loadTsMorph();
  if (!mod) return [];
  const { SyntaxKind } = mod;
  let project: any;
  try { project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } }); }
  catch { return []; }

  const issues: EffectLeakIssue[] = [];
  const seen = new Set<string>();

  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!CODE_FILE.test(path) || EXCLUDE.test(path) || !content.includes('useEffect')) continue;
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    let calls: any[];
    try { calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression); } catch { continue; }
    for (const call of calls) {
      let name = '';
      try { name = call.getExpression?.()?.getText?.() ?? ''; } catch { continue; }
      if (name !== 'useEffect') continue;
      let cb: any;
      try { cb = call.getArguments?.()?.[0]; } catch { continue; }
      const cbKind = cb?.getKind?.();
      if (cbKind !== SyntaxKind.ArrowFunction && cbKind !== SyntaxKind.FunctionExpression) continue;

      // Find a leaky setup call anywhere in the effect body.
      let resource = '';
      try {
        for (const c of cb.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const callee = c.getExpression?.();
          const n = callee?.getKind?.() === SyntaxKind.PropertyAccessExpression ? callee.getName?.() : callee?.getText?.();
          const base = typeof n === 'string' ? n.replace(/^.*\./, '') : '';
          if (LEAKY_SETUPS.has(base)) { resource = base; break; }
        }
      } catch { /* ignore */ }
      if (!resource) continue;

      // Does the effect RETURN a cleanup function? Conservative: any return of a function anywhere in the
      // callback (block body) OR a concise arrow whose body IS a function. Presence of a cleanup → don't flag.
      let hasCleanup = false;
      try {
        const body = cb.getBody?.();
        if (body?.getKind?.() === SyntaxKind.Block) {
          for (const ret of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
            const e = ret.getExpression?.();
            const ek = e?.getKind?.();
            if (ek === SyntaxKind.ArrowFunction || ek === SyntaxKind.FunctionExpression || ek === SyntaxKind.Identifier || ek === SyntaxKind.CallExpression) { hasCleanup = true; break; }
          }
        } else if (body) {
          // concise-body arrow `() => something` — a cleanup only if it directly returns a function.
          const bk = body.getKind?.();
          hasCleanup = bk === SyntaxKind.ArrowFunction || bk === SyntaxKind.FunctionExpression;
        }
      } catch { hasCleanup = false; }
      if (hasCleanup) continue;

      const line = (() => { try { return call.getStartLineNumber?.() ?? 0; } catch { return 0; } })();
      const key = `${path}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        kind: 'missing-effect-cleanup', file: path, line, resource,
        detail: `useEffect at ${path}:${line} calls ${resource}(...) but returns no cleanup — it leaks (keeps firing after unmount and doubles on every re-run). Return a cleanup: e.g. \`const id = setInterval(...); return () => clearInterval(id);\` or \`return () => el.removeEventListener(...)\`.`,
      });
      if (issues.length >= MAX_ISSUES) break;
    }
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Advisory report line(s), or '' when clean. Pure. */
export function effectCleanupSummary(issues: EffectLeakIssue[]): string {
  if (!issues || issues.length === 0) return '';
  const shown = issues.slice(0, 8).map((i) => `  ⚠️ ${i.file}:${i.line} — useEffect calls ${i.resource}() with no cleanup (leak)`);
  return `Performance — ${issues.length} useEffect(s) leak a resource (no cleanup returned):\n${shown.join('\n')}${issues.length > 8 ? `\n  …and ${issues.length - 8} more` : ''}`;
}
