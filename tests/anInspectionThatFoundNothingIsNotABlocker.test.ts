// 🔴 failedbr #2431 (21d59838): the release gate listed "3 build-breaking blocker(s)", two of them read-only looks — a
// `…; grep -n "nb-" src/nb-autostyle.css` that found no match, and `ls …; cat .env.example 2>/dev/null` on a project with
// no .env.example. A sequence exits with its LAST statement, and only `|` was split. Reversion: drop the `;`-split, or the
// `2>/dev/null` probe rule, and the matching case fails.
import { describe, it, expect } from 'vitest';
import { isExpectedNonzeroExit } from '../src/server/AgentV3/BuildDiagnostics';

describe('the #2431 commands are probes, not failures', () => {
  it('a sequence ending in a grep that found nothing', () => {
    expect(isExpectedNonzeroExit('grep -n "^export" src/lib/imageAi.ts | head -30; echo ---; cat src/App.css; echo ---; grep -n "nb-" src/nb-autostyle.css', 1)).toBe(true);
  });
  it('a look at a file the author said might be absent', () => {
    expect(isExpectedNonzeroExit('ls src src/components 2>/dev/null; cat .env.example 2>/dev/null', 1)).toBe(true);
  });
});

describe('real failures stay failures', () => {
  it('a sequence ending in a build', () => {
    expect(isExpectedNonzeroExit('grep -n x a.ts; npm run build', 1)).toBe(false);
  });
  it('cat WITHOUT the redirect, and an && chain', () => {
    expect(isExpectedNonzeroExit('cat src/App.tsx', 1)).toBe(false);
    expect(isExpectedNonzeroExit('npm run build && grep -n x a.ts', 1)).toBe(false);
  });
  it('a semicolon inside a quoted pattern is not a statement break', () => {
    expect(isExpectedNonzeroExit('npx tsc --noEmit; echo "a; grep b"', 2)).toBe(false);
  });
});
