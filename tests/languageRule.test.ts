/**
 * THE TWO-WAY LANGUAGE RULE (admin 2026-08-11, restating CLAUDE.md's Language standard).
 *
 * There are exactly two halves and no third:
 *
 *   1. **NavBharatAI's own text = professional ENGLISH.** Buttons, labels, settings, error toasts —
 *      AND every status line the SERVER emits during a build. Those are the PLATFORM speaking.
 *   2. **Every AI RESPONSE = the user's language.** Chat replies, model-written narration, Doctor AI,
 *      every Professional. This is the single exception, and it is delivered by a PROMPT rule — the
 *      models are natively multilingual, so no translation service is involved.
 *
 * These tests exist because a session got this backwards: ROADMAP item 6 told it to translate the
 * server's status lines, it shipped a Hindi catalogue, and the work had to be reverted. Locking both
 * halves means the next session cannot repeat it from either direction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { narrationText, _catalogue, type NarrationId } from '../src/server/AgentV3/narrationCatalogue';
import { describeFile, _labels, type FileRole } from '../src/lib/fileRole';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('half 1 — the PLATFORM speaks professional English', () => {
  it('every build status line is English', () => {
    const sample = {
      count: 2, enums: 'Role', file: 'src/App.tsx', packages: 'zod',
      changed: 'vite@5.4.0', added: 'react', from: 'a.ts', to: 'b.ts',
    };
    for (const id of Object.keys(_catalogue) as NarrationId[]) {
      expect(DEVANAGARI.test(narrationText(id, sample as never)), id).toBe(false);
    }
  });

  it('every file label is English', () => {
    for (const role of Object.keys(_labels) as FileRole[]) {
      expect(DEVANAGARI.test(_labels[role]), role).toBe(false);
    }
    expect(describeFile('src/components/LoginForm.tsx')).toBe('a part of a screen');
  });

  it('the per-build language machinery is GONE, not merely unused', () => {
    // Leaving a half-wired translation layer in place would be a feature that is neither working nor
    // absent — the state the second absolute rule exists to forbid.
    expect(existsSync('src/server/lib/narrationLanguage.ts')).toBe(false);
    const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(dispatcher).not.toContain('setNarrationLanguage');
    expect(dispatcher).not.toContain('narrationLang');
    const catalogue = readFileSync('src/server/AgentV3/narrationCatalogue.ts', 'utf8');
    expect(catalogue).not.toMatch(/NarrationLanguage|CATALOGUES/);
  });

  it('no server status line is written in Devanagari at the SOURCE', () => {
    const files = execSync(
      "find src/server -name '*.ts' | grep -v '\\.test\\.' | grep -v goldenScaffolds | grep -v 'generator/templates'",
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      if (/\/\._/.test(f)) continue;
      let lines: string[];
      try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
      lines.forEach((l, i) => {
        if (!/type: 'narration'/.test(l)) return;
        const block = lines.slice(i, i + 4).join(' ');
        const m = /text:\s*(.*?),\s*ts:/s.exec(block);
        if (m && DEVANAGARI.test(m[1])) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('half 2 — every AI RESPONSE follows the user', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('the build/plan/chat prompts carry the mirror-the-user rule', () => {
    const sp = read('src/server/AgentV3/systemPrompt.ts');
    expect(sp).toContain('LANGUAGE — MIRROR THE USER, NEVER DEFAULT');
    expect(sp).toMatch(/do NOT default to Hindi/i);
  });

  it('the Professionals carry it', () => {
    expect(read('src/server/professionals/engine.ts')).toMatch(/Reply in the user's language/i);
  });

  it('🔒 Doctor AI carries it too — it used to say the OPPOSITE', () => {
    // The real gap found on 2026-08-11: the prompt read "LANGUAGE: Primarily English medical
    // terminology", on the one surface aimed at rural/junior doctors most likely to write in Hindi.
    const sda = read('src/server/routes/sda.ts');
    expect(sda).not.toContain('LANGUAGE: Primarily English medical terminology');
    expect(sda).toContain('LANGUAGE — MIRROR THE DOCTOR, NEVER DEFAULT');
  });

  it('Doctor AI still keeps CLINICAL TERMS in English — a translated drug name is a safety risk', () => {
    // Mirroring the user must not extend to the one thing that has to be looked up on a prescription.
    const sda = read('src/server/routes/sda.ts');
    expect(sda).toContain('CLINICAL TERMS STAY IN ENGLISH');
    expect(sda).toMatch(/drug names|patient-safety/i);
  });

  it('🔒 no translation service is wired in — the models do this natively', () => {
    // A translator would re-translate an already-correct reply, add latency to every message, cost per
    // character, and mangle code blocks. The prompt rule costs nothing and is what actually works.
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(/translat|@vitalets|google-translate|libretranslate|deepl/i.test(name), name).toBe(false);
    }
  });
});
