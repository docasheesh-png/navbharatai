/**
 * failedbr #2100 (2026-11-08, "DriveEasy"): customer, driver and admin features were 32 numbered ITEMS under plain
 * headings. Three items carried sub-bullets (a booking form's fields) and the payment bullets followed item 12, so
 * the spec was read as "4 numbered sections": a 40-part, three-role app with a backend was sized small, went to the
 * fast lane (480 s budget, 69 type errors handed on) and then to the 25-minute cap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sectionedSpecSize } from '../src/server/AgentV3/enumeratedFeatures';
import { megaProjectSignals } from '../src/server/AgentV3/ProjectPlan';

const prompt = readFileSync(join(__dirname, 'fixtures', 'failedbr2100.driveeasy.prompt.txt'), 'utf8');

describe('a numbered list with a few sub-bullets is not a spec in sections', () => {
  it('the real prompt is sized by its 40 parts, and the project gate fires', () => {
    expect(sectionedSpecSize(prompt)).toBeNull();
    expect(megaProjectSignals(prompt).fires).toBe(true);
  });

  it('a real sectioned spec — every numbered heading heads its own bullets — is still sized by its sections', () => {
    const spec = [1, 2, 3, 4].map((n) => `${n}. Screen ${n}\n- Previous\n- Play/Pause\n- Next\n- Song name`).join('\n\n');
    expect(sectionedSpecSize(spec)).toBe(4);
  });
});
