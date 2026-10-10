import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * UI-7 — the live preview toolbar rendered zoom and theme twice (a badly indented pair left in
 * place beside the real one). Const declarations earlier in the component do not count; only the
 * JSX in the live-mode toolbar (the branch that has a URL) does.
 */
describe('UI-7 live toolbar has one of each button', () => {
  it('the live-mode toolbar uses {zoomButton} and {themeButton} exactly once', () => {
    const src = readFileSync('src/components/agentv3/PreviewSurface.tsx', 'utf8');
    const start = src.indexOf("if (mode === 'live' && effectiveUrl)");
    expect(start).toBeGreaterThan(-1);
    // The next live return is the empty state ("No live preview yet") — not this toolbar.
    const next = src.indexOf("if (mode === 'live')", start + 1);
    expect(next).toBeGreaterThan(start);
    const segment = src.slice(start, next);
    const count = (needle: string) => segment.split(needle).length - 1;
    expect(count('{zoomButton}')).toBe(1);
    expect(count('{themeButton}')).toBe(1);
  });
});
