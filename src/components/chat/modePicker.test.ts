import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  modePickerEntries, recentModeEntries, nextRecentAfterClose, filterModeEntries, activeModeId, isModeSurface,
  FREE_MODE_ID, IMAGE_MODE_ID, recentModeId, recentTargetFromId, startsFreshOnPick,
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
 *
 * ⚠️ AND AGAIN 2026-09-22: the ONE recent row became a GROUP of every open chat (admin: "upar recent
 * chat, niche new chat … recent me woh chat jo abhi open hai, up to 5"), keyed by CONVERSATION so two
 * Teacher chats are two rows, and the header's chips went away. The Recent group is built from the
 * OPEN TABS and the OPEN WINDOWS, not from `activeView` alone — the cases below say so.
 */
describe('modePickerEntries — what the Mode button offers', () => {
  // The admin's own numbering: "1. recent chat, 2. navbharatai free, 3. images generator ai,
  // 4. doctor ai,........ and so on!"
  it('with an AI open: its recent row, then FREE, Image Generator, Doctor, then every professional', () => {
    const win = { id: 'c1', professionalId: 'teacher_ai' };
    const entries = modePickerEntries({ hideMedical: false, activeView: 'teacher_ai', openViews: ['teacher_ai'], openChats: [win] });
    expect(entries[0]).toMatchObject({ id: recentModeId('teacher_ai', 'c1'), name: 'Teacher AI', kind: 'recent', view: 'teacher_ai', conversationId: 'c1' });
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
    const win = { id: 'c1', professionalId: 'teacher_ai' };
    const entries = modePickerEntries({ hideMedical: false, activeView: 'teacher_ai', openViews: ['teacher_ai'], openChats: [win] });
    const rows = entries.filter((e) => e.name === 'Teacher AI');
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].kind).toBe('recent');
    expect(rows[1].kind).toBe('professional');
  });

  it('NO recent row when no chat is open — a row offering to resume nothing is a fake button', () => {
    for (const view of ['professionals', 'home', '']) {
      const entries = modePickerEntries({ hideMedical: false, activeView: view, openViews: [view, 'settings'], openChats: [] });
      expect(entries.some((e) => e.kind === 'recent'), view).toBe(false);
      expect(entries[0]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
    }
  });

  it('the recent group names the FREE chat when that tab is open', () => {
    const entries = modePickerEntries({ hideMedical: false, activeView: 'nbi_chat', openViews: ['nbi_chat'] });
    expect(entries[0]).toMatchObject({ id: recentModeId('nbi_chat'), kind: 'recent', name: 'NavBharatAI FREE', view: 'nbi_chat' });
    // …and the row beneath it is still the NEW free chat. Same words, different jobs — which is why
    // the sheet puts them under different group headings.
    expect(entries[1]).toMatchObject({ id: FREE_MODE_ID, kind: 'free' });
  });

  it('🔴 THE RECENT GROUP IS EVERY OPEN CHAT, in the New group\'s order then window order (2026-09-22)', () => {
    // Admin's own example: "doctor ai, teacher ai (1), teacher ai (2), other (1), other (2)".
    const openChats = [
      { id: 't1', professionalId: 'teacher_ai' },
      { id: 'l1', professionalId: 'lawyer_ai' },
      { id: 't2', professionalId: 'teacher_ai' },
    ];
    const recent = recentModeEntries({ hideMedical: false, activeView: 'lawyer_ai', openViews: ['nbi_chat', 'sda_chat', 'teacher_ai', 'lawyer_ai', 'settings'], openChats });
    expect(recent.map((e) => [e.id, e.name])).toEqual([
      [recentModeId('nbi_chat'), 'NavBharatAI FREE'],
      [recentModeId('sda_chat'), 'Doctor AI'],
      [recentModeId('teacher_ai', 't1'), 'Teacher AI (1)'],
      [recentModeId('lawyer_ai', 'l1'), PROFESSIONAL_CHATS.lawyer_ai.name],
      [recentModeId('teacher_ai', 't2'), 'Teacher AI (2)'],
    ]);
    // A view that is open but is not a chat (settings) is not a recent row; a professional VIEW that
    // is open contributes rows only through its WINDOWS, never as a bare view.
    expect(recent.some((e) => e.view === 'settings')).toBe(false);
    expect(recent.filter((e) => e.view === 'teacher_ai').every((e) => e.conversationId)).toBe(true);
    // The image studio is a recent row while its view is open, wherever it was opened from.
    const withImage = recentModeEntries({ hideMedical: false, openViews: ['nbi_chat', IMAGE_MODE_ID], openChats: [] });
    expect(withImage.map((e) => e.view)).toEqual(['nbi_chat', IMAGE_MODE_ID]);
  });

  it('🔴 a CLOSED free chat leaves the Recent group while its tab stays open (admin 2026-09-22)', () => {
    // "recent chat me navbharatai free ko x karte hai, to navbharatai free pura window hi band ho jata
    // hai, chahe 3-5 kitne bhi ai open ho!" — the tab is home to the others, so closing the FREE
    // conversation must not close it; the flag is what takes FREE out of the list instead.
    const openChats = [{ id: 't1', professionalId: 'teacher_ai' }];
    const open = recentModeEntries({ hideMedical: false, openViews: ['nbi_chat', 'sda_chat', 'teacher_ai'], openChats });
    expect(open.map((e) => e.view)).toEqual(['nbi_chat', 'sda_chat', 'teacher_ai']);
    const closed = recentModeEntries({ hideMedical: false, openViews: ['nbi_chat', 'sda_chat', 'teacher_ai'], openChats, freeChatClosed: true });
    expect(closed.map((e) => e.view)).toEqual(['sda_chat', 'teacher_ai']);
  });

  it('🔴 after a close the screen goes to the row BELOW, else above, and null means the last chat closed', () => {
    // "mode navbharatai free ko agar band kiya jaye, to uske niche jo on ho woh open ho jaye … agar
    // kebal ek hi AI open hai, aur user usko bhi band kar de! to … navbharatai free ka page open ho jaye"
    const openChats = [{ id: 't1', professionalId: 'teacher_ai' }, { id: 't2', professionalId: 'teacher_ai' }];
    const recent = recentModeEntries({ hideMedical: false, openViews: ['nbi_chat', 'sda_chat', 'teacher_ai'], openChats });
    expect(recent.map((e) => e.id)).toEqual([recentModeId('nbi_chat'), recentModeId('sda_chat'), recentModeId('teacher_ai', 't1'), recentModeId('teacher_ai', 't2')]);
    // FREE closed → Doctor AI (below).
    expect(nextRecentAfterClose(recent, recentModeId('nbi_chat'))?.id).toBe(recentModeId('sda_chat'));
    // The last row closed → the one above it.
    expect(nextRecentAfterClose(recent, recentModeId('teacher_ai', 't2'))?.id).toBe(recentModeId('teacher_ai', 't1'));
    // A middle row closed → the one below it, never the one above.
    expect(nextRecentAfterClose(recent, recentModeId('teacher_ai', 't1'))?.id).toBe(recentModeId('teacher_ai', 't2'));
    // The only chat closed → null: the caller opens a fresh FREE page.
    expect(nextRecentAfterClose([recent[0]], recentModeId('nbi_chat'))).toBeNull();
    // An id not in the list closes nothing that was listed: stay somewhere real.
    expect(nextRecentAfterClose(recent, 'recent:ghost')?.id).toBe(recentModeId('nbi_chat'));
    expect(nextRecentAfterClose([], 'recent:ghost')).toBeNull();
  });

  it('a recent WINDOW row round-trips its view AND conversation through its id', () => {
    expect(recentTargetFromId(recentModeId('teacher_ai', 'abc#1'))).toEqual({ view: 'teacher_ai', conversationId: 'abc#1' });
    expect(recentTargetFromId(recentModeId('nbi_chat'))).toEqual({ view: 'nbi_chat' });
    expect(recentTargetFromId('teacher_ai')).toBeNull();
    expect(recentTargetFromId(FREE_MODE_ID)).toBeNull();
  });

  it('a medical expert never becomes a recent row on the native shell', () => {
    const entries = modePickerEntries({ hideMedical: true, activeView: 'sda_chat', openViews: ['sda_chat', 'pharmacist_ai'], openChats: [{ id: 'p1', professionalId: 'pharmacist_ai' }] });
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

  it('the fixed rows survive every search — every recent row, FREE and the image studio', () => {
    const win = { id: 'c1', professionalId: 'teacher_ai' };
    const out = filterModeEntries(modePickerEntries({ hideMedical: false, activeView: 'teacher_ai', openViews: ['nbi_chat', 'teacher_ai'], openChats: [win] }), 'zzzz-no-match');
    expect(out.map((e) => e.id)).toEqual([recentModeId('nbi_chat'), recentModeId('teacher_ai', 'c1'), FREE_MODE_ID, IMAGE_MODE_ID]);
  });
});

describe('activeModeId / isModeSurface — the ✓ and the footer', () => {
  it('the ✓ is on the RECENT row, never on the list row of the same AI', () => {
    // The list row means "start a new one", which is not the state the user is in. Ticking it would
    // say the opposite of what tapping it does.
    expect(activeModeId('nbi_chat')).toBe(recentModeId('nbi_chat'));
    expect(activeModeId('sda_chat')).toBe(recentModeId('sda_chat'));
    // A professional's ✓ names the WINDOW on screen — never its sibling window (2026-09-22).
    expect(activeModeId('teacher_ai', 'c2')).toBe(recentModeId('teacher_ai', 'c2'));
    expect(activeModeId('teacher_ai')).toBe(recentModeId('teacher_ai'));
    // A single-chat view ignores a stale window id: the FREE chat has no windows.
    expect(activeModeId('nbi_chat', 'c2')).toBe(recentModeId('nbi_chat'));
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

  it('a recent row SWITCHES to its exact conversation and starts nothing', () => {
    // The conversation id rides into `toggleTab`, which focuses that window — the same path the header
    // chip used until 2026-09-22, so there is one switch, not two.
    expect(app).toContain('const resume = recentTargetFromId(id);');
    expect(app).toContain('if (resume) { toggleTab(resume.view as ViewType, true, resume.conversationId); return; }');
  });

  it('a professional\'s "New chat" opens a NEW WINDOW with a fresh conversation — the open one is neither archived nor dropped', () => {
    // Until 2026-09-21 the live conversation was ENDED here (archived, then a fresh mount), because a
    // professional could hold only one. Now it stays open beside the new window, which is minted with
    // its own conversation id — the id the server keeps the two chats' memory apart by.
    expect(app).toContain('if (startsFreshOnPick(id)) {');
    expect(app).toContain('toggleTab(id as ViewType, true, newConversationId());');
    const pick = app.slice(app.indexOf('onPick={(id) =>'), app.indexOf('onPick={(id) =>') + 2500);
    expect(pick).not.toContain('endProfessionalChat(');
  });

  it('the image row opens Other Tools\' OWN view — free and paid together, not a fork', () => {
    expect(app).toContain('if (id === IMAGE_MODE_ID) {');
    expect(app).toContain('toggleTab(IMAGE_MODE_ID as ViewType);');
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
    for (const e of modePickerEntries({ hideMedical: false, activeView: 'teacher_ai', openViews: ['nbi_chat', 'teacher_ai'], openChats: [{ id: 'c1', professionalId: 'teacher_ai' }] })) {
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

  it('the list is TWO GROUPS with headings — Recent chat over New chat — and no per-row tags (2026-09-22)', () => {
    // Admin: "har option ke age new likhne ki need nahi hai, 2 alag alag group hi bana do". The per-row
    // "Recent" / "New chat" tags that told the two rows of one AI apart until now are replaced by the
    // heading each group sits under.
    expect(sheet).toContain("groupHeading('Recent chat')");
    expect(sheet).toContain("groupHeading('New chat')");
    expect(sheet).toContain('aria-label="Recent chat"');
    expect(sheet).toContain('aria-label="New chat"');
    expect(sheet).not.toContain('>Recent<');
    expect(sheet).not.toContain('>New chat<');
    // The Recent group is hidden entirely when empty — a heading over nothing promises a way back to nothing.
    expect(sheet).toContain('{recent.length > 0 && (');
    // Every recent row carries the ✕; no New row does.
    expect(sheet).toContain("{e.kind === 'recent' && onCloseRecent && (");
  });

  it('it builds the list from the OPEN TABS and OPEN WINDOWS, or the Recent group could never know what is open', () => {
    expect(sheet).toContain('modePickerEntries({ hideMedical, activeView, openViews, openChats, freeChatClosed })');
    expect(sheet).toContain('[hideMedical, activeView, openViews, openChats, freeChatClosed]');
    expect(sheet).toContain('activeModeId(activeView, activeChatId)');
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
