import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ROOT CAUSE, twice (admin 2026-08-02 Publish sheet → #2037; admin 2026-08-03 Import/Push modal):
// a modal card with NO height cap grows past a phone screen, and `overflow-hidden`/no-scroll makes
// everything below the fold UNREACHABLE. Both times the feature underneath worked perfectly — the
// Publish buttons ran, the GitHub push really committed — but their controls and their only feedback
// were off-screen, so both were reported as "farzi / kaam ka nahi hai".
//
// This is the tripwire for the CLASS: any full-screen-overlay modal card must cap its height AND
// scroll. Checked structurally (not per-component) so a NEW modal cannot reintroduce it.
const FILES = [
  'src/components/agentv3/AgentV3Panel.tsx',
  'src/components/agentv3/HostingChooser.tsx',
];

/** Modal "card" = a positioned, full-width, rounded panel inside a fixed overlay. */
const CARD_RE = /className="([^"]*\brelative\b[^"]*\bz-\d+[^"]*\bw-full\b[^"]*\brounded-[^"]*)"/g;

describe('modal cards must cap their height and scroll (phone-reachability tripwire)', () => {
  for (const rel of FILES) {
    it(`${rel}: every overlay modal card is capped + scrollable`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      const offenders: string[] = [];
      for (const m of src.matchAll(CARD_RE)) {
        const cls = m[1];
        const capped = /\bmax-h-\[/.test(cls);
        const scrolls = /\boverflow-y-auto\b|\boverflow-auto\b/.test(cls);
        // A card that delegates scrolling to an inner body is fine — it still must be capped.
        if (!capped || (!scrolls && !/\bflex\b/.test(cls))) {
          offenders.push(cls.slice(0, 120));
        }
      }
      expect(offenders, `uncapped/unscrollable modal card(s):\n${offenders.join('\n')}`).toEqual([]);
    });
  }

  it('the Import/Push modal specifically is capped and scrollable (the reported case)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    const idx = src.indexOf('{/* Import Repo Modal */}');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1400);
    expect(block).toContain('max-h-[85vh]');
    expect(block).toContain('overflow-y-auto');
  });

  it('the push result stays visible while scrolling (it is the push\'s only feedback)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    const idx = src.indexOf('Push status / result');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 900)).toContain('sticky bottom-0');
  });
});
