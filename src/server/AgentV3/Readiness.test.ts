import { describe, it, expect } from 'vitest';
import { assessReadiness, readinessVerdict, maturityTier, maturityTierLabel } from './Readiness';
import { checkPreviewCompiles, previewDivergenceBlocksDelivery } from '../runtime/PreviewCompileCheck';
import type { ArchitectureReport } from './ArchitectureAnalysis';
import type { SecurityFinding } from './SecurityAnalysis';

const cleanArch: ArchitectureReport = {
  fileCount: 5, edgeCount: 6, cycles: [], unresolvedImports: [], layeringViolations: [], nodeBuiltinsInFrontend: [], orphanComponents: [],
};

describe('readiness compile-honesty (autopsy 2026-08-02 — "READY 70/100" for a build whose preview will not compile)', () => {
  // The health card is computed WITHOUT the in-browser preview compiler, so a build whose ENTRY file will
  // not compile scored "READY · 70/100" while the live preview white-screened. The classic case: the
  // duplicate `ErrorBoundary` import that BABEL (the preview compiler) rejects but esbuild/tsc/vite ACCEPT.
  // The gate now runs the same babel dry-compile and feeds an ENTRY-file divergence in as a HIGH blocker.
  it('BABEL rejects the duplicate ErrorBoundary import that esbuild accepts (the real compiler divergence)', () => {
    const main = 'import ErrorBoundary from \'./ErrorBoundary\';\nimport { ErrorBoundary } from "./ErrorBoundary";\nexport default ErrorBoundary;\n';
    const pc = checkPreviewCompiles({ 'src/main.tsx': main });
    expect(pc.ok).toBe(false);
    expect(previewDivergenceBlocksDelivery(pc.errors)).toBe(true); // it is an ENTRY file → blocks delivery
  });
  it('an entry-file preview divergence, fed in as a HIGH finding, forces NOT READY', () => {
    const main = 'import ErrorBoundary from \'./ErrorBoundary\';\nimport { ErrorBoundary } from "./ErrorBoundary";\nexport default ErrorBoundary;\n';
    const pc = checkPreviewCompiles({ 'src/main.tsx': main });
    const entryErr = pc.errors.find((e) => previewDivergenceBlocksDelivery([e]));
    const extra = [{ severity: 'high' as const, label: `the live preview will not compile — ${entryErr?.file}: ${entryErr?.message}` }];
    const r = assessReadiness(cleanArch, [], extra);
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => /the live preview will not compile/.test(b))).toBe(true);
  });
  it('a clean, compiling app is UNAFFECTED — no divergence, still READY (no false block)', () => {
    const pc = checkPreviewCompiles({ 'src/main.tsx': 'import App from \'./App\';\nexport default App;\n', 'src/App.tsx': 'export default function App(){ return null; }\n' });
    expect(pc.ok).toBe(true);
    expect(assessReadiness(cleanArch, [], []).ready).toBe(true);
  });
});

describe('maturityTier', () => {
  it('a not-ready build (a blocker or a sub-floor score) is at most a prototype', () => {
    expect(maturityTier({ ready: false, score: 95, blockers: ['x'] })).toBe('prototype');
    expect(maturityTier({ ready: true, score: 40, blockers: [] })).toBe('prototype'); // below MIN_READY_SCORE
  });
  it('climbs hackathon → production → enterprise as the score rises', () => {
    expect(maturityTier({ ready: true, score: 60, blockers: [] })).toBe('hackathon');
    expect(maturityTier({ ready: true, score: 80, blockers: [] })).toBe('production');
    expect(maturityTier({ ready: true, score: 100, blockers: [] })).toBe('enterprise');
  });
  it('every tier has an honest, non-empty label', () => {
    for (const t of ['prototype', 'hackathon', 'production', 'enterprise'] as const) {
      expect(maturityTierLabel(t).length).toBeGreaterThan(0);
    }
  });
  it('assessReadiness attaches the tier (a clean project is enterprise-grade)', () => {
    expect(assessReadiness(cleanArch, []).tier).toBe('enterprise');
  });
});

describe('assessReadiness', () => {
  it('scores a clean project 100 and READY', () => {
    const r = assessReadiness(cleanArch, []);
    expect(r.score).toBe(100);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('an unresolved import is a hard blocker (not ready) AND names the specifier so it can be diagnosed', () => {
    const r = assessReadiness({ ...cleanArch, unresolvedImports: ['a.ts -> ./missing'] }, []);
    expect(r.ready).toBe(false);
    expect(r.score).toBeLessThan(100);
    expect(r.blockers.join(' ')).toContain('unresolved');
    // ShopSphere autopsy: the blocker must include WHICH import (not just a count) — undiagnosable otherwise.
    expect(r.blockers.join(' ')).toContain('a.ts -> ./missing');
  });

  it('lists up to 3 unresolved specifiers with an ellipsis for the rest', () => {
    const r = assessReadiness({ ...cleanArch, unresolvedImports: ['a -> ./1', 'b -> ./2', 'c -> ./3', 'd -> ./4'] }, []);
    const blocker = r.blockers.find((b) => b.includes('unresolved import'))!;
    expect(blocker).toContain('a -> ./1');
    expect(blocker).toContain('c -> ./3');
    expect(blocker).toContain('…');
    expect(blocker).not.toContain('d -> ./4'); // capped at 3 + ellipsis
  });

  it('a server-only Node builtin in front-end code is a hard blocker (browser-build-breaker, not READY)', () => {
    // Regression: `import fs from "fs"` in a React component breaks the Vite browser build, but the
    // gate never read arch.nodeBuiltinsInFrontend → it reported READY 100/100 (fake success).
    const r = assessReadiness({ ...cleanArch, nodeBuiltinsInFrontend: ['src/components/FileList.tsx -> fs'] }, []);
    expect(r.ready).toBe(false);
    expect(r.score).toBeLessThan(100);
    expect(r.blockers.join(' ')).toContain('browser build');
    expect(r.blockers.join(' ')).toContain('fs');
  });

  it('a high-severity security finding blocks readiness', () => {
    const finding: SecurityFinding = { file: 'a.ts', line: 1, severity: 'high', rule: 'hardcoded-secret', message: 'x' };
    const r = assessReadiness(cleanArch, [finding]);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(' ')).toContain('high-severity');
  });

  it('surfaces the ACTUAL security finding (rule @ file:line — message), not just a count', () => {
    const finding: SecurityFinding = { file: 'src/Login.tsx', line: 42, severity: 'high', rule: 'credentials-in-localstorage', message: 'Password stored in localStorage — anyone with XSS can read it.' };
    const r = assessReadiness(cleanArch, [finding]);
    const blocker = r.blockers.find((b) => b.includes('high-severity')) ?? '';
    expect(blocker).toContain('credentials-in-localstorage');
    expect(blocker).toContain('src/Login.tsx:42');
    expect(blocker).toContain('Password stored in localStorage');
  });

  it('cycles and low/medium issues lower the score but do not block', () => {
    const r = assessReadiness(
      { ...cleanArch, cycles: [['a', 'b', 'a']] },
      [{ file: 'a.ts', line: 1, severity: 'low', rule: 'insecure-http', message: 'x' }],
    );
    expect(r.ready).toBe(true);
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('is deterministic and clamps to 0..100', () => {
    const manyBlockers = { ...cleanArch, unresolvedImports: Array(10).fill('a -> b') };
    const r1 = assessReadiness(manyBlockers, []);
    const r2 = assessReadiness(manyBlockers, []);
    expect(r1.score).toBe(r2.score);
    expect(r1.score).toBeGreaterThanOrEqual(0);
  });

  it('an orphan component (generated but never imported/rendered) is a WARNING, not a blocker', () => {
    // A build that compiles and runs must never be forced NOT READY just because one component isn't
    // wired in yet — that would risk a false-positive rebuild loop. It's real, but ship-with-warning.
    const r = assessReadiness({ ...cleanArch, orphanComponents: ['src/components/Hero.tsx (Hero)'] }, []);
    expect(r.ready).toBe(true);
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.join(' ')).toContain('Hero.tsx');
  });

  // THE reported honesty bug (admin, 2026-07-05): a build with 27 orphan components — all WARNINGS,
  // no single hard blocker — cratered the score to 0, yet the engine reported "Build health: READY ·
  // 0/100". A low score is itself a not-ready signal: it must now be NOT READY, with an honest reason.
  it('a warning pile that craters the score below the floor is NOT READY (no more "READY · 0/100")', () => {
    const orphans = Array.from({ length: 27 }, (_, i) => `src/components/C${i}.tsx (C${i})`);
    const r = assessReadiness({ ...cleanArch, orphanComponents: orphans }, []);
    expect(r.score).toBe(0);            // 27 × 6 penalty, clamped
    expect(r.ready).toBe(false);        // was true (the bug) — now honestly blocked
    expect(r.blockers.join(' ')).toMatch(/below the 50\/100 bar/);
    expect(readinessVerdict(r)).toContain('NOT READY');
  });

  // Boundary: a build just AT the floor with no hard blocker stays READY (the floor never
  // false-blocks a genuinely-acceptable build).
  it('a build at/above the score floor with no hard blocker stays READY', () => {
    // 8 orphans × 6 = 48 off → score 52 (≥ 50) → still READY.
    const orphans = Array.from({ length: 8 }, (_, i) => `src/components/C${i}.tsx (C${i})`);
    const r = assessReadiness({ ...cleanArch, orphanComponents: orphans }, []);
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.ready).toBe(true);
  });
});

describe('assessReadiness — extra findings', () => {
  it('a high extra finding is a hard blocker (NOT READY)', () => {
    const r = assessReadiness(cleanArch, [], [{ severity: 'high', label: 'Secret leak: .env not gitignored' }]);
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('Secret leak: .env not gitignored');
    expect(r.score).toBeLessThan(100);
  });

  it('a medium/low extra finding lowers the score but stays READY', () => {
    const r = assessReadiness(cleanArch, [], [
      { severity: 'medium', label: 'No error boundary' },
      { severity: 'low', label: 'minor thing' },
    ]);
    expect(r.ready).toBe(true);
    expect(r.score).toBeLessThan(100);
    expect(r.warnings).toEqual(expect.arrayContaining(['No error boundary', 'minor thing']));
  });

  it('defaults to no extra findings (backward compatible)', () => {
    expect(assessReadiness(cleanArch, []).ready).toBe(true);
    expect(assessReadiness(cleanArch, []).score).toBe(100);
  });
});

describe('readinessVerdict', () => {
  it('states READY or NOT READY clearly', () => {
    expect(readinessVerdict(assessReadiness(cleanArch, []))).toContain('READY');
    const notReady = readinessVerdict(assessReadiness({ ...cleanArch, unresolvedImports: ['x -> y'] }, []));
    expect(notReady).toContain('NOT READY');
    expect(notReady).toContain('Must fix');
  });
});
