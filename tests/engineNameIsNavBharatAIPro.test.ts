import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * THE ENGINE'S USER-FACING NAME IS "NavBharatAI Pro" — no version number (admin 2026-09-12:
 * *"app builder engine bas navbharatai pro, nam se karo! yeh v5 ya v3 sab change kar ke sirf
 * navbharatai pro rahne do"*).
 *
 * 🔴 WHAT THIS TEST DOES **NOT** TOUCH, and why that distinction is the whole point.
 *
 * The INTERNAL identifiers keep their names, deliberately:
 *   • the `AGENTV3_*` environment variables — 248 of them, **set by hand in Cloud Run**. Renaming one
 *     in code does not rename it in the console: the process simply stops finding it, every flag it
 *     gated silently reverts to its default, and NOTHING in the codebase can detect that. This file
 *     already records two doc-vs-reality drifts of exactly that shape.
 *   • `/api/agentv3/*` (83 routes) — an installed Android build posts to these paths and cannot be
 *     updated from the server.
 *   • `agentv3_*` Firestore collections (27) — they hold existing users' data.
 *
 * So the rule is: a **user** must never read a version number as part of the product's name; the code
 * may keep whatever identifier production depends on. This test enforces the first half only, by
 * looking at strings and JSX text and ignoring comments.
 */
const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Strip block, whole-line AND TRAILING comments, so an internal note using the old shorthand is not a
 * failure. The trailing case is the one that matters: `toggleTab('nbi_pro_chat'); // legacy id → Pro
 * v5.0` is a comment on a code line, and a filter that only looked at line STARTS reported it as a
 * user-visible string. The `(?<!:)` guard keeps `https://` intact.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .map((l) => l.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

const FILES = walk(SRC);

describe('the app builder is named "NavBharatAI Pro", with no version number', () => {
  it('no user-visible string carries a versioned product name', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      for (const bad of [
        'NavBharatAI Pro v5', 'NavBharatAI Pro v3', 'navBharatAI Pro v5',
        'NavBharatAI v5', 'Pro v5.0', 'Pro v3.0', 'Vargen',
      ]) {
        if (code.includes(bad)) offenders.push(`${f.replace(SRC, 'src')}: ${bad}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the menu label and the Professionals card both read "NavBharatAI Pro"', () => {
    expect(readFileSync(join(SRC, 'App.tsx'), 'utf8'))
      .toContain("{ id: 'nbi_pro_chat', label: 'NavBharatAI Pro', icon: Bot }");
    expect(readFileSync(join(SRC, 'components/professionals/ProfessionalsView.tsx'), 'utf8'))
      .toContain("label: 'NavBharatAI Pro'");
  });

  it('🔒 the AI introduces ITSELF by that name — the one place a wrong name is unmissable', () => {
    const prompt = readFileSync(join(SRC, 'server/AgentV3/systemPrompt.ts'), 'utf8');
    expect(prompt).toContain('You are NavBharatAI Pro —');
    expect(codeOnly(prompt)).not.toMatch(/You are NavBharatAI Pro v\d/);
  });

  it('🔒 the INTERNAL identifiers are untouched — renaming these would break production', () => {
    // Asserted as a positive, not an absence: this is the half of the rename that must NOT happen, and
    // a future "finish the rename" pass should fail here rather than in Cloud Run.
    const route = readFileSync(join(SRC, 'server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("'/api/agentv3/");
    expect(route).toMatch(/AGENTV3_[A-Z_]+/);
  });
});

/**
 * THE DEAD BUTTON THE RENAME FOUND, AND THE CLASS BEHIND IT (2026-09-12).
 *
 * The sidebar's most builder-looking row, "App Builder v5.0", called `toggleTab('engine_builder')` —
 * and the separate `engine_builder` view had been removed from App.tsx long before ("Separate
 * 'engine_builder' v5.0 view REMOVED"). Tapping it rendered NOTHING. Worse, the knowledge base named
 * that row as THE way to reach the builder, so every AI in the product confidently sent users to a
 * blank screen.
 *
 * 🔴 TWO EXISTING TESTS ASSERTED THAT BUTTON'S PRESENCE, and one of them opens by declaring it "pins
 * the corrected navigation so no NavBharatAI AI sends a user to a control that is gone". They passed
 * throughout, because they asserted a LABEL exists — and a label's existence says nothing about
 * whether its destination still renders. That is the gap this block closes: not "is the text there"
 * but "does tapping it arrive anywhere".
 *
 * Pinned as a CLASS rather than as the one instance: every destination the sidebar can navigate to
 * must be rendered by some view. When this was written, `engine_builder` was the only one of the six
 * with zero render sites — the other five had two or three each.
 */
const RENDERERS = walk(join(SRC, 'components')).concat([join(SRC, 'App.tsx')]);

describe('every sidebar destination actually arrives somewhere', () => {
  const sidebar = readFileSync(join(SRC, 'components/panels/SidebarNav.tsx'), 'utf8');
  const rendered = new Set<string>();
  for (const f of RENDERERS) {
    for (const m of readFileSync(f, 'utf8').matchAll(/activeView === '([a-z_]+)'/g)) rendered.add(m[1]);
  }

  it('no hardcoded sidebar button navigates to a view nothing renders', () => {
    const targets = [...codeOnly(sidebar).matchAll(/toggleTab\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(targets.length, 'expected to find sidebar navigation targets').toBeGreaterThan(0);
    const dead = [...new Set(targets)].filter((t) => !rendered.has(t));
    expect(dead, `sidebar navigates to view(s) nothing renders: ${dead.join(', ')}`).toEqual([]);
  });

  it('🔒 the removed "engine_builder" door does not come back', () => {
    expect(codeOnly(sidebar)).not.toMatch(/toggleTab\('engine_builder'\)/);
    expect(rendered.has('engine_builder'), 'engine_builder has no view — it must stay unreachable').toBe(false);
  });
});

/**
 * The knowledge base is what every AI reads to answer "where is X?", so a version number there is not
 * cosmetic — it is the name a user is TOLD. `keywords` are deliberately exempt: they are search terms,
 * and a user who still types "v5" must keep finding the builder.
 */
describe('the knowledge base never tells a user a versioned name', () => {
  it('no name / path / description / howToUse carries an engine version', () => {
    const offenders: string[] = [];
    for (const f of APP_KNOWLEDGE_BASE) {
      for (const field of ['name', 'path', 'description', 'howToUse'] as const) {
        const v = (f as Record<string, unknown>)[field];
        if (typeof v === 'string' && /\bv[35]\.0\b|Vargen/i.test(v)) offenders.push(`${f.id}.${field}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the builder entry points at a gate that really exists in the UI', () => {
    const entry = APP_KNOWLEDGE_BASE.find((f) => f.id === 'agentv3_builder');
    expect(entry, 'agentv3_builder entry missing').toBeTruthy();
    expect(entry!.path).toMatch(/NavBharatAI Pro/);
    // The label it names must be a real, rendered menu entry — not a row that was deleted.
    expect(readFileSync(join(SRC, 'App.tsx'), 'utf8')).toContain("label: 'NavBharatAI Pro'");
  });
});
