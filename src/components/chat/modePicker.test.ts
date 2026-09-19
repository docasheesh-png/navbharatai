import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  modePickerEntries, filterModeEntries, activeModeId, isModeSurface,
  FREE_MODE_ID, IMAGE_MODE_ID, recentModeId, startsFreshOnPick,
} from './modePicker';
import { PROFESSIONAL_CHATS } from '../professionals/professionalConfigs';

/**
 * THE MODE PICKER (admin 2026-08-25): the Free chat's Mode button is the professionals' new front
 * door — the Home tile is gone. These tests pin the list's composition, the compliance filter, and
 * the App wiring that a pure test can see; each rule here is one the admin stated explicitly.
 *
 * ⚠️ REWRITTEN 2026-09-19, and the cases that changed are the POINT rather than collateral. This file
 * pinned "FREE resumes, FREE + starts a new one, an expert resumes" — the exact behaviour the admin
 * replaced. Each such case is updated in place with the reason, never deleted: the old assertion was
 * right about the old rule, and a test removed silently is a rule nobody can see was withdrawn.
 */
describe('modePickerEntries — what the Mode button offers', () => {
  // The admin's own numbering: "1. recent chat, 2. navbharatai free, 3. images generator ai,
  // 4. doctor ai,........ and so on!"
  it('with an AI open: recent, FREE, Image Generator, Doctor, then every professional', () => {
    const entries = modePickerEntries({ hideMedical: false, activeView: 'teacher_ai' });
    expect(entries[0]).toMatchObject({ id: recentModeId('teacher_ai'), name: 'Teacher AI', kind: 'recent' });
    expect(entries[1]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
    expect(entries[2]).toMatchObject({ id: IMAGE_MODE_ID, name: 'Image Generator AI', kind: 'image' });
    expect(entries[3]).toMatchObject({ id: 'sda_chat', name: 'Doctor AI' });
    // Every configured professional is in the list — none silently dropped.
    for (const id of Object.keys(PROFESSIONAL_CHATS)) {
      expect(entries.some((e) => e.id === id), `missing ${id}`).toBe(true);
    }
  });

  it('the open AI appears TWICE, with different ids — that is the design, not a duplicate', () => {
    // Admin, asked directly: "agar user teacher ai open kiya hua hai … mode ke andar sabse upar
    // teacher ai dikhega, aur list me bhi teacher ai hoga, user list me teacher ai par tap kare to
    // teacher ai ki NEW chat open hogi." Two rows, one name, opposite actions — so the IDS must differ
    // or the caller cannot tell them apart.
    const entries = modePickerEntries({ hideMedical: false, activeView: 'teacher_ai' });
    const rows = entries.filter((e) => e.name === 'Teacher AI');
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].kind).toBe('recent');
    expect(rows[1].kind).toBe('professional');
  });

  it('NO recent row when no AI is open — a row offering to resume nothing is a fake button', () => {
    for (const view of ['professionals', 'home', '']) {
      const entries = modePickerEntries({ hideMedical: false, activeView: view });
      expect(entries.some((e) => e.kind === 'recent'), view).toBe(false);
      expect(entries[0]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
    }
  });

  it('the recent row names the FREE chat when that is what is open', () => {
    const entries = modePickerEntries({ hideMedical: false, activeView: 'nbi_chat' });
    expect(entries[0]).toMatchObject({ kind: 'recent', name: 'NavBharatAI FREE' });
    // …and the row beneath it is still the NEW free chat. Same words, different jobs — which is why
    // the sheet tags them.
    expect(entries[1]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
  });

  it('a medical expert never becomes the recent row on the native shell', () => {
    const entries = modePickerEntries({ hideMedical: true, activeView: 'sda_chat' });
    expect(entries.some((e) => e.kind === 'recent')).toBe(false);
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

  it('the fixed rows survive every search — recent, FREE and the image studio', () => {
    const out = filterModeEntries(modePickerEntries({ hideMedical: false, activeView: 'teacher_ai' }), 'zzzz-no-match');
    expect(out.map((e) => e.id)).toEqual([recentModeId('teacher_ai'), FREE_MODE_ID, IMAGE_MODE_ID]);
  });
});

describe('activeModeId / isModeSurface — the ✓ and the footer', () => {
  it('the ✓ is on the RECENT row, never on the list row of the same AI', () => {
    // The list row means "start a new one", which is not the state the user is in. Ticking it would
    // say the opposite of what tapping it does.
    expect(activeModeId('nbi_chat')).toBe(recentModeId('nbi_chat'));
    expect(activeModeId('sda_chat')).toBe(recentModeId('sda_chat'));
    expect(activeModeId('teacher_ai')).toBe(recentModeId('teacher_ai'));
    expect(activeModeId('home')).toBe('');
  });

  it('every chat surface carries the Mode footer; the builder does not', () => {
    // `imagegen` joined the list, so it must carry the button too — otherwise the image studio is a
    // room with no door back.
    for (const v of ['nbi_chat', 'professionals', 'sda_chat', 'teacher_ai', 'lawyer_ai', IMAGE_MODE_ID]) {
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

  it('the FREE row genuinely starts a NEW chat before opening the Free surface', () => {
    // Was pinned as `NEW_FREE_MODE_ID` — the row that did this is now the only FREE row there is.
    expect(app).toContain("if (id === FREE_MODE_ID) { startNewChat(); toggleTab('nbi_chat'); return; }");
  });

  it('the recent row RESUMES and starts nothing', () => {
    expect(app).toContain('const resume = viewFromRecentId(id);');
    expect(app).toContain('if (resume) { toggleTab(resume as ViewType); return; }');
  });

  it('a professional is ARCHIVED before its new chat, never dropped', () => {
    // endProfessionalChat puts the transcript in Professional History and clears the live slot, so the
    // next mount is fresh. Without this the "new chat" would either resurrect the old one on mount or
    // delete it outright.
    expect(app).toContain('if (startsFreshOnPick(id)) {');
    expect(app).toContain('if (store) endProfessionalChat(store, id);');
  });

  it('the image row opens Other Tools\' OWN view — free and paid together, not a fork', () => {
    expect(app).toContain("if (id === IMAGE_MODE_ID) { toggleTab(IMAGE_MODE_ID as ViewType); return; }");
    const panels = readFileSync(join(__dirname, '..', 'panels', 'ViewPanels.tsx'), 'utf8');
    expect(panels).toContain("activeView === 'imagegen'");
    expect(panels).toContain('<AIImageGenerator');
    // The tier toggle lives inside that component, so both tiers ride along by construction.
    const gen = readFileSync(join(__dirname, '..', 'ide', 'AIImageGenerator.tsx'), 'utf8');
    expect(gen).toContain('ImageStudioPro');
  });

  it('🔴 Doctor AI RESUMES — it has no archive, so a new chat would destroy the case', () => {
    // Its transcript is `sda_messages` plus ONE fixed Firestore doc per user, and
    // ProfessionalHistoryView iterates PROFESSIONAL_CHATS, which does not contain it. Until Doctor AI
    // has a per-conversation archive, "always new" would mean "always delete the previous case".
    expect(startsFreshOnPick('sda_chat')).toBe(false);
    expect(startsFreshOnPick('teacher_ai')).toBe(true);
    const profHistory = readFileSync(join(__dirname, '..', 'professionals', 'ProfessionalHistoryView.tsx'), 'utf8');
    expect(profHistory).toContain('Object.entries(PROFESSIONAL_CHATS)');
    expect(Object.keys(PROFESSIONAL_CHATS)).not.toContain('sda_chat');
  });

  it('archiving is scoped to the professionals endProfessionalChat was written for', () => {
    // The guard must be a real predicate, not "anything that is not the free row". A widened rule
    // would reach Doctor AI and the image studio, whose storage that function knows nothing about —
    // it would write an archive nobody reads and clear nothing.
    for (const id of [FREE_MODE_ID, IMAGE_MODE_ID, 'sda_chat', 'nbi_pro_chat', recentModeId('teacher_ai')]) {
      expect(startsFreshOnPick(id), `${id} must not be archived by the professionals path`).toBe(false);
    }
    for (const id of Object.keys(PROFESSIONAL_CHATS)) {
      expect(startsFreshOnPick(id), `${id} is a professional and must start fresh`).toBe(true);
    }
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

  it('the built entries all carry one — the recent, FREE and image rows included', () => {
    for (const e of modePickerEntries({ hideMedical: false, activeView: 'teacher_ai' })) {
      expect(e.emoji, `${e.id} lost its emoji`).toBeTruthy();
    }
  });

  it('no two neighbouring domains share one emoji by accident (the map is all distinct)', async () => {
    const { MODE_EMOJI } = await import('./modePicker');
    const all = Object.values(MODE_EMOJI);
    expect(new Set(all).size).toBe(all.length);
  });
});

/**
 * THE SHEET — the two rows of one AI must be tellable apart on screen, not just in the data.
 *
 * With Teacher AI open the list holds "Teacher AI" twice: once to go back, once to start over. The
 * data distinguishes them by id; a person distinguishes them by the tag. Without the tags this feature
 * is a coin flip, which is why they are pinned here and not left to taste.
 */
describe('ModePickerSheet — the rows say which is which', () => {
  const sheet = readFileSync(join(__dirname, 'ModePickerSheet.tsx'), 'utf8');

  it('the recent row is tagged Recent, and the ones that start something are tagged New chat', () => {
    expect(sheet).toContain(">Recent<");
    expect(sheet).toContain(">New chat<");
    expect(sheet).toContain("e.kind === 'recent' &&");
    expect(sheet).toContain("(e.kind === 'free' || e.kind === 'professional') &&");
  });

  it('it builds the list with the ACTIVE view, or row 1 could never know what is open', () => {
    expect(sheet).toContain('modePickerEntries({ hideMedical, activeView })');
    expect(sheet).toContain('[hideMedical, activeView]');
  });

  it('the FREE styling follows the NAME, so the same chat is painted the same way in both rows', () => {
    expect(sheet).toContain("e.name === 'NavBharatAI FREE'");
    // The old branch keyed on kind, which would have left the recent row's "NavBharatAI FREE" plain
    // while the row beneath it kept the gradient — one chat, two looks, in one list.
    expect(sheet).not.toContain("e.kind === 'free' || e.kind === 'free_new'");
  });

  it('nothing renders the retired "+" any more', () => {
    // Comment-stripped: this file's own prose explains the retired row, and a needle that matches its
    // own explanation is a test that can never fail for the reason it was written (CLAUDE.md names
    // this trap). The first run of this case caught a genuinely STALE doc comment in the sheet, which
    // is the one kind of prose that should fail — so it was fixed rather than exempted.
    const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('free_new');
    expect(code).not.toContain('NEW_FREE_MODE_ID');
  });
});
