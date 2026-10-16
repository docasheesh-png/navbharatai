/**
 * WHERE EVERY SCREEN ACTUALLY IS — the lock for the admin's 2026-10-14 report.
 *
 * Admin, verbatim: *"navbharatai ke kisi ai ko pata hi nahi hai, ki 'secrets and keys' kaha dali jani hai.
 * jab koi user google login wala page banata hai, to navbharatai bata raha hai, ki other ke jankar secret
 * and keys dalo! jab ki secrets and keys to setting me hai! self awearnwss ko wapas se theek karo! sabhi
 * option kaha kaha hai, wapas revise karo!!"*
 *
 * They were right, and the measurement was worse than the report:
 *   • the keys vault is named in 155 places under TWO names for ONE screen — 126 `Secrets & API Keys`
 *     (the real Settings tab) and 37 `Keys & Secrets` (the builder's sheet);
 *   • EIGHT spelled out `⋮ More → Keys & Secrets`, a menu that exists only inside the Pro panel — and one
 *     of the eight was `NO_FAKE_FEATURE_RULE`, printed in RED into every built app waiting for a key, so a
 *     user who opened Settings looking for "Keys & Secrets" found nothing;
 *   • `settings_modules` sent users to `Settings → Modules`, a screen the code says was REMOVED on
 *     2026-08-14 — and that same entry told them to paste their own Gemini/OpenAI/Groq/Claude keys, which
 *     is both a vendor-name leak (the White-Label Law) and the BYOK feature CLAUDE.md forbids re-proposing;
 *   • `Live Metrics` was claimed as an App Settings tab; it is an admin-only button at the bottom of the menu;
 *   • THIRTEEN `relatedFeatures` ids pointed at entries that do not exist — including `secrets_keys`, the
 *     keys screen itself under an id that never existed.
 *
 * 🔑 THE POINT OF THIS FILE IS THE DRIFT, NOT THE STRINGS. It reads the REAL UI — `SettingsPanel.tsx`'s own
 * group titles and tab labels — and fails when the registry, the knowledge base and the screen disagree.
 * Renaming a tab now breaks CI instead of quietly making every AI sentence wrong, which is the only thing
 * that would have caught the reported bug before a user met it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTINGS_GROUPS, SECRETS_SCREEN, whereToSaveKeys, demoUntilKeySaved } from '../src/server/AppContext/navPaths';
import { NO_FAKE_FEATURE_RULE } from '../src/server/AgentV3/noEvalRule';
import { KEYS_PATH_PHONE, KEYS_PATH_WEB } from '../src/server/AgentV3/fakeFeatureScan';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const panel = read('src/components/panels/SettingsPanel.tsx');
const kb = read('src/server/AppContext/AppKnowledgeBase.ts');

/** The groups and tabs the Settings screen really renders. */
const realGroups = [...panel.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
const realTabs = new Map([...panel.matchAll(/\{ id: '([a-z_]+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]] as const));

describe('🔒 the registry matches the screen it describes', () => {
  it('the three Settings group titles are the real ones', () => {
    for (const title of Object.values(SETTINGS_GROUPS)) {
      expect(realGroups, `"${title}" is not a group the Settings screen renders`).toContain(title);
    }
  });

  it("the keys tab's label is read from the screen, not guessed", () => {
    expect(realTabs.get('secrets')).toBe(SECRETS_SCREEN.label);
  });

  it('the canonical path is built from that label and that group', () => {
    expect(SECRETS_SCREEN.canonical).toBe(`Settings → ${SETTINGS_GROUPS.app} → ${SECRETS_SCREEN.label}`);
    // And the label really does sit in the App Settings group, not another one.
    const appGroupAt = panel.indexOf(`title: '${SETTINGS_GROUPS.app}'`);
    const nextGroupAt = panel.indexOf("title: '", appGroupAt + 10);
    const appGroupBlock = panel.slice(appGroupAt, nextGroupAt > 0 ? nextGroupAt : undefined);
    expect(appGroupBlock).toContain(`label: '${SECRETS_SCREEN.label}'`);
  });

  it("the in-builder shortcut's label is the sheet's own title", () => {
    const agentPanel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(agentPanel).toContain(`'${SECRETS_SCREEN.inBuilderLabel}'`);
    expect(SECRETS_SCREEN.inBuilderPath).toContain(SECRETS_SCREEN.inBuilderLabel);
  });
});

describe('🔴 what a BUILT APP prints when it is waiting for a key — the reported bug', () => {
  it('names the canonical Settings path, not the builder-only menu', () => {
    const line = demoUntilKeySaved('Google sign-in', 'VITE_SUPABASE_URL');
    expect(line).toContain(SECRETS_SCREEN.canonical);
    expect(line).not.toContain('⋮ More');
    expect(line).toMatch(/is a demo, not real/);
  });

  it('and the rule every lane carries says the same', () => {
    expect(NO_FAKE_FEATURE_RULE).toContain(SECRETS_SCREEN.canonical);
    // The exact string the admin reported, as the WHOLE address, must be gone from that rule.
    expect(NO_FAKE_FEATURE_RULE).not.toMatch(/in NavBharatAI → ⋮ More → Keys & Secrets/);
  });

  it('the in-builder shortcut is still offered — it is the same vault, just a convenience', () => {
    expect(whereToSaveKeys({ inBuilder: true })).toContain(SECRETS_SCREEN.canonical);
    expect(whereToSaveKeys({ inBuilder: true })).toContain(SECRETS_SCREEN.inBuilderPath);
    expect(whereToSaveKeys()).toBe(SECRETS_SCREEN.canonical);
  });

  it('the fake-feature scan derives both paths instead of typing them', () => {
    expect(KEYS_PATH_WEB).toBe(SECRETS_SCREEN.canonical);
    expect(KEYS_PATH_PHONE).toContain(SECRETS_SCREEN.inBuilderPath);
    const src = read('src/server/AgentV3/fakeFeatureScan.ts');
    expect(src).toContain("from '../AppContext/navPaths'");
    // Every place it tells a user where to paste must name the WEBSITE path too — one of three used to
    // name only the phone menu, which is the "a rule enforced at one of N call sites" class.
    for (const m of src.matchAll(/KEYS_PATH_PHONE/g)) {
      const around = src.slice(Math.max(0, m.index! - 400), m.index! + 400);
      expect(around, 'a KEYS_PATH_PHONE use with no KEYS_PATH_WEB beside it').toContain('KEYS_PATH_WEB');
    }
  });
});

describe('🔒 every Settings path the AIs quote leads somewhere that exists', () => {
  const paths = [...kb.matchAll(/^\s*path: '((?:[^'\\]|\\.)*)'/gm)].map((m) => m[1]);

  it('the knowledge base still has the entries this census is for', () => {
    expect(paths.length).toBeGreaterThan(200);
  });

  it('no path names a Settings GROUP that does not exist (this caught "Settings → Modules")', () => {
    const bad: string[] = [];
    for (const p of paths) {
      if (!p.startsWith('Settings')) continue;
      const second = p.split('→')[1]?.trim() ?? '';
      if (!second || second.startsWith('scroll')) continue; // prose, deliberately not a group name
      if (!realGroups.includes(second)) bad.push(p);
    }
    expect(bad).toEqual([]);
  });

  it('no path claims an App Settings TAB that does not exist (this caught "Live Metrics")', () => {
    const labels = new Set(realTabs.values());
    const bad: string[] = [];
    for (const p of paths) {
      if (!p.startsWith(`Settings → ${SETTINGS_GROUPS.app} → `)) continue;
      // The tab is the third step, up to the first punctuation that starts prose.
      const third = (p.split('→')[2] ?? '').split(/[—(",]/)[0].trim();
      if (third && !labels.has(third)) bad.push(`${p}  ↳ "${third}"`);
    }
    expect(bad).toEqual([]);
  });

  it('the screen removed on 2026-08-14 is not offered to anyone any more', () => {
    expect(kb).not.toContain("'Settings → Modules'");
    expect(kb).not.toContain('settings_modules');
    // And the panel still says it was removed — if that changes, this census needs re-reading.
    expect(panel).toMatch(/The `modules` screen was REMOVED/);
  });

  it('🔴 and that entry\'s other two faults are gone with it: no vendor names, no bring-your-own-AI-key', () => {
    // The deleted entry told users to paste their own Gemini/OpenAI/Groq/DeepSeek/Claude keys to power the
    // app's AI. That is the BYOK feature CLAUDE.md says must never be built or re-proposed, and naming the
    // vendors breaks the White-Label Law. Checked on the ENTRY text only, since legitimate entries discuss
    // a user's own third-party provider keys (a Mapbox token, a Razorpay key) by name.
    expect(kb).not.toMatch(/Supported providers: Gemini \(Google\), OpenAI/);
    expect(kb).not.toMatch(/Brain Engine/);
  });
});

describe('🔒 every cross-reference points at a real entry', () => {
  const ids = new Set([...kb.matchAll(/^\s*id: '([a-z0-9_]+)',/gm)].map((m) => m[1]));
  const related = new Set<string>();
  for (const m of kb.matchAll(/relatedFeatures: \[([^\]]*)\]/g)) {
    for (const r of m[1].matchAll(/'([a-z0-9_]+)'/g)) related.add(r[1]);
  }

  it('no relatedFeatures id dangles (there were THIRTEEN, including the keys screen itself)', () => {
    expect([...related].filter((r) => !ids.has(r)).sort()).toEqual([]);
  });

  it('the census is not vacuous — the links really are there to check', () => {
    expect(ids.size).toBeGreaterThan(150);
    expect(related.size).toBeGreaterThan(100);
  });

  it('the keys screen is reachable from the entries that send users to it', () => {
    expect(ids.has('settings_secrets')).toBe(true);
    expect(related.has('settings_secrets')).toBe(true);
    expect(related.has('secrets_keys')).toBe(false); // the id that never existed
  });
});
