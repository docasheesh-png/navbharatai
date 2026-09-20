// ONE WAY BACK, AND EVERYONE KNOWS WHERE IT IS.
//
// Admin 2026-09-20, two instructions together: *"system A ko hata do agar safe ho to. B hi lagao"* and
// *"par sabhi ko pata hona chahiye. galti hone par backup/revers kaise liya jaye!!"*
//
// NavBharatAI had two version systems. The Pro panel showed the weaker one — git commits INSIDE the
// sandbox — with a Restore button, and `/api/agentv3/restore` says in its own comment that it "can
// offer a restore the sandbox can no longer perform". The sandbox pauses after minutes and is rebuilt
// from durable files; the history those commits live in goes with it. A button that works this minute
// and not tomorrow is only ever pressed on the day it matters.
//
// 🔒 THE TWO HALVES SHIP TOGETHER OR NEITHER SHOULD. Removing the control alone would have moved the
// way back from a screen the user is already on to a tool three menus deep — making the admin's SECOND
// instruction worse while satisfying the first. So the note that names the durable path is asserted
// here beside the removal.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HISTORY_TAB_NOTE, HOW_TO_GO_BACK, TIME_MACHINE_PATH } from '../src/components/agentv3/versionHelp';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const ROOT = path.resolve(__dirname, '..');
const panelRaw = fs.readFileSync(path.join(ROOT, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
// ⚠️ THE COMMENTS ARE STRIPPED BEFORE ANY "IS IT GONE?" ASSERTION, because the removal deliberately
// LEAVES A COMMENT NAMING WHAT WAS REMOVED AND WHY — that note is the whole reason the decision
// survives the next reader, and a test that cannot tell a comment from a call site would force it to
// be deleted. `stripCodeComments` blanks length-preservingly, so positions still line up.
const panel = stripCodeComments(panelRaw);

describe('the sandbox restore is gone from the panel', () => {
  it('no per-checkpoint Restore button remains', () => {
    expect(panel).not.toContain('handleRestoreCheckpoint');
    expect(panel).not.toMatch(/title="Restore to this checkpoint"/);
  });

  it('the panel no longer calls the sandbox restore at all', () => {
    // A handler left behind beside a removed button is how the button comes back: the next reader
    // finds a ready-made restore and a list to hang it on, and the decision is silently undone.
    expect(panel).not.toMatch(/\brestore\(/);
    expect(panel).not.toMatch(/start, respond, restore,/);
  });

  it('but PREVIEW and COMPARE stay — only git can do them, and neither claims to bring anything back', () => {
    // ⚠️ THE CALL SITE, NOT THE DEFINITION. Asserting the function NAME passes while the button that
    // calls it is gutted — the definition survives on its own. Proven: removing only the onClick left
    // this test green until it was written this way.
    expect(panel).toContain('handlePreviewCheckpoint(c.sha)');
    expect(panel).toContain('Compare two versions');
    // Naming a version stays too: a list of identical auto-messages is what made it unusable before.
    expect(panel).toContain('beginLabelEdit(c.sha,');
  });

  it('and the DURABLE whole-project restore is untouched — it reads the saved files, not the sandbox', () => {
    expect(panel).toContain('handleRestoreAll');
    expect(panel).toContain('Restore all files');
  });
});

describe('the replacement is named in the same place', () => {
  it('the History tab carries the note', () => {
    expect(panel).toContain('{HISTORY_TAB_NOTE}');
    expect(panel).toMatch(/import \{ HISTORY_TAB_NOTE \} from '\.\/versionHelp'/);
  });

  it('the note gives the exact path, not the word "settings"', () => {
    expect(HISTORY_TAB_NOTE).toContain(TIME_MACHINE_PATH);
    expect(TIME_MACHINE_PATH).toBe('Other AI → AI Tools → Versioning');
  });

  it('it states the DIFFERENCE, because a user who does not know it presses the wrong one', () => {
    expect(HISTORY_TAB_NOTE).toMatch(/this session/i);
    expect(HISTORY_TAB_NOTE).toMatch(/any device/i);
    expect(HISTORY_TAB_NOTE).toMatch(/permanently/i);
  });

  it('the one-line answer to "I made a mistake" says nothing is deleted', () => {
    expect(HOW_TO_GO_BACK).toContain(TIME_MACHINE_PATH);
    expect(HOW_TO_GO_BACK).toMatch(/Restore/);
    expect(HOW_TO_GO_BACK).toMatch(/Nothing is deleted/i);
  });

  it('never promises a number of days — the limit is a COUNT (versionRetention.ts)', () => {
    for (const text of [HISTORY_TAB_NOTE, HOW_TO_GO_BACK]) {
      expect(text.toLowerCase()).not.toMatch(/\d+\s*(day|days|week|month)/);
    }
  });
});

describe('every NavBharatAI AI can answer "galti ho gayi, wapas kaise jaun?"', () => {
  const kb = fs.readFileSync(path.join(ROOT, 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('the Versioning entry states the same path the panel points at', () => {
    expect(kb).toContain(TIME_MACHINE_PATH.replace(/ → /g, ' → '));
  });
});
