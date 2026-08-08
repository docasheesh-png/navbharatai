import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { SECRETS_TILE, SECRETS_PATH } from '../src/lib/settingsLabels';

/**
 * THE SCREEN THAT DOES NOT EXIST (root-caused 2026-08-07).
 *
 * The vault tile is called **"Secrets & API Keys"**. Twenty-two user-facing strings across the codebase
 * sent people to "Settings → Secrets & Keys" — a screen with that name is nowhere in the app. Each one
 * is an instruction a real user follows and fails, and one of them was worse than the rest: the BUILD
 * PROMPT (`systemPrompt.ts`) told the AI to give users that path, so the engine generated the wrong
 * directions on demand.
 *
 * The label had been hardcoded independently in every message, so when the tile was renamed most were
 * never updated. `polishCollabSettings.test.ts` already guarded the KNOWLEDGE BASE against exactly this
 * — which is how it surfaced — but nothing guarded the strings the engine and the settings screens
 * actually print, and those had quietly drifted.
 *
 * Fixing the strings alone would repeat the mistake at a later date. The label lives in ONE module now,
 * and this test fails if any source file spells the stale one again.
 */

const ROOT = join(__dirname, '..', 'src');
const STALE = 'Secrets & Keys';

/** Every .ts/.tsx under src, except this rule's own definition and the tests that quote the stale label. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (name.includes('.test.')) continue;              // tests may quote the stale label to assert its absence
    if (full.endsWith('settingsLabels.ts')) continue;   // the one file that names it, to explain the bug
    out.push(full);
  }
  return out;
}

describe('The settings tile is named in ONE place', () => {
  it('exports the real label and the full path a message would print', () => {
    expect(SECRETS_TILE).toBe('Secrets & API Keys');
    expect(SECRETS_PATH).toBe('Settings → Secrets & API Keys');
  });

  it('the real label is a SUPERSTRING of the stale one — which is why the drift was invisible', () => {
    // "Secrets & API Keys" does not contain "Secrets & Keys", so a substring check really does separate
    // them. If that ever stopped being true this whole guard would silently pass on broken text.
    expect(SECRETS_TILE.includes(STALE)).toBe(false);
  });
});

describe('No source file sends a user to a screen that does not exist', () => {
  const files = sourceFiles(ROOT);

  it('scans a real, non-trivial set of files (a broken walker must not pass by finding nothing)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('none of them contains the stale label', () => {
    const offenders = files
      .filter((f) => readFileSync(f, 'utf8').includes(STALE))
      .map((f) => f.slice(f.indexOf('/src/') + 1));
    // Import SECRETS_PATH (src/lib/settingsLabels.ts) instead of writing the name by hand.
    expect(offenders).toEqual([]);
  });

  it('the build prompt gives the AI the REAL path — it generates directions for users on demand', () => {
    const prompt = readFileSync(join(ROOT, 'server/AgentV3/systemPrompt.ts'), 'utf8');
    expect(prompt).toContain(SECRETS_TILE);
    expect(prompt).not.toContain(STALE);
  });
});
