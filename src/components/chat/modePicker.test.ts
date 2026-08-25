import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { modePickerEntries, filterModeEntries, activeModeId, isModeSurface, FREE_MODE_ID, NEW_FREE_MODE_ID } from './modePicker';
import { PROFESSIONAL_CHATS } from '../professionals/professionalConfigs';

/**
 * THE MODE PICKER (admin 2026-08-25): the Free chat's Mode button is the professionals' new front
 * door — the Home tile is gone. These tests pin the list's composition, the compliance filter, and
 * the App wiring that a pure test can see; each rule here is one the admin stated explicitly.
 */
describe('modePickerEntries — what the Mode button offers', () => {
  it('FREE first (the default), then "FREE +" (a new chat), then Doctor, then every professional', () => {
    const entries = modePickerEntries({ hideMedical: false });
    expect(entries[0]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
    expect(entries[1]).toMatchObject({ id: NEW_FREE_MODE_ID, kind: 'free_new' });
    expect(entries[2]).toMatchObject({ id: 'sda_chat', name: 'Doctor AI' });
    // Every configured professional is in the list — none silently dropped.
    for (const id of Object.keys(PROFESSIONAL_CHATS)) {
      expect(entries.some((e) => e.id === id), `missing ${id}`).toBe(true);
    }
  });

  it('NavBharatAI Pro v5 is NOT in the list — it has its own Home tile (admin\'s exact instruction)', () => {
    const entries = modePickerEntries({ hideMedical: false });
    for (const id of ['nbi_pro_chat', 'engineer_ai']) {
      expect(entries.some((e) => e.id === id), `${id} must not be offered`).toBe(false);
    }
  });

  it('the native shell hides every medical-class expert — same Play-compliance rule as the hub', () => {
    const entries = modePickerEntries({ hideMedical: true });
    for (const id of ['sda_chat', 'pharmacist_ai', 'firstaid_ai', 'maternity_ai']) {
      expect(entries.some((e) => e.id === id), `${id} must be hidden on native`).toBe(false);
    }
    expect(entries.some((e) => e.id === 'teacher_ai')).toBe(true);
  });
});

describe('filterModeEntries — search never hides the way back', () => {
  it('filters experts by name, case-insensitively', () => {
    const out = filterModeEntries(modePickerEntries({ hideMedical: false }), 'lawyer');
    expect(out.some((e) => e.id === 'lawyer_ai')).toBe(true);
    expect(out.some((e) => e.id === 'chef_ai')).toBe(false);
  });

  it('the two FREE rows survive every search', () => {
    const out = filterModeEntries(modePickerEntries({ hideMedical: false }), 'zzzz-no-match');
    expect(out.map((e) => e.id)).toEqual([FREE_MODE_ID, NEW_FREE_MODE_ID]);
  });
});

describe('activeModeId / isModeSurface — the ✓ and the footer', () => {
  it('marks the surface the user is actually on', () => {
    expect(activeModeId('nbi_chat')).toBe(FREE_MODE_ID);
    expect(activeModeId('sda_chat')).toBe('sda_chat');
    expect(activeModeId('teacher_ai')).toBe('teacher_ai');
    expect(activeModeId('home')).toBe('');
  });

  it('every chat surface carries the Mode footer; the builder does not', () => {
    for (const v of ['nbi_chat', 'professionals', 'sda_chat', 'teacher_ai', 'lawyer_ai']) {
      expect(isModeSurface(v), v).toBe(true);
    }
    for (const v of ['nbi_pro_chat', 'home', 'settings', 'studio']) {
      expect(isModeSurface(v), v).toBe(false);
    }
  });
});

describe('the App wiring this feature depends on (source-pinned)', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

  it('the footer Mode button is LIVE — no "coming soon" toast is left on it', () => {
    expect(app).toContain('setShowModePicker(true)');
    expect(app).not.toContain('Mode switching — coming soon');
  });

  it('"FREE +" genuinely starts a NEW chat before opening the Free surface', () => {
    expect(app).toContain('if (id === NEW_FREE_MODE_ID) { startNewChat(); toggleTab(\'nbi_chat\'); return; }');
  });

  it('the FREE surface\'s History is the unified, tagged list', () => {
    expect(app).toContain("includeProfessionals={historyInitialFilter === 'free'}");
  });

  it('the Home page no longer renders a Professionals tile, and the hub stays reachable elsewhere', () => {
    const home = readFileSync(join(__dirname, '..', 'home', 'HomeView.tsx'), 'utf8');
    expect(home).not.toContain("id: 'professionals'");
    // The ☰ sidebar entry survives — desktop and deep links still have a door.
    expect(app).toContain("{ id: 'professionals', label: 'Professionals',");
  });
});

/**
 * EMOJI LOGOS (admin 2026-08-25: "emoji logo bhi sath me hon, maja aa jayega"). The completeness
 * check is the real rule: a professional added without its own emoji fails HERE, instead of shipping
 * with the generic briefcase and nobody noticing.
 */
describe('every mode entry carries its own emoji logo', () => {
  it('EVERY configured professional has an explicit emoji — no silent fallback', async () => {
    const { MODE_EMOJI, FALLBACK_EMOJI } = await import('./modePicker');
    for (const id of Object.keys(PROFESSIONAL_CHATS)) {
      expect(MODE_EMOJI[id], `professional "${id}" has no emoji in MODE_EMOJI`).toBeTruthy();
      expect(MODE_EMOJI[id]).not.toBe(FALLBACK_EMOJI);
    }
    expect(MODE_EMOJI.sda_chat).toBe('🩺');
  });

  it('the built entries all carry one — FREE rows included', () => {
    for (const e of modePickerEntries({ hideMedical: false })) {
      expect(e.emoji, `${e.id} lost its emoji`).toBeTruthy();
    }
  });

  it('no two neighbouring domains share one emoji by accident (the map is all distinct)', async () => {
    const { MODE_EMOJI } = await import('./modePicker');
    const all = Object.values(MODE_EMOJI);
    expect(new Set(all).size).toBe(all.length);
  });
});
