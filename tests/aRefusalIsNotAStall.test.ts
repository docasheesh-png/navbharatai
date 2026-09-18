/**
 * 🔴 AUTOPSY 95598899 (2026-09-18) — the engine overrode its own model's honest answer and rewrote a
 * user's app.
 *
 * Workspace: a 35-file Qiikr classifieds marketplace. Prompt: *"Make a video of parrot talking about
 * the benefits of fruits in urdu"*. The first model answered in 8 seconds that NavBharatAI builds web
 * apps and cannot make videos, and asked which the user wanted. Zero tool calls, `end_turn`.
 *
 * `AgentRunner`'s NUDGE-TO-BUILD saw `toolUses.length === 0`, concluded "stalled", and replied to its
 * own model: *"ACT NOW … Start by writing the entry file (e.g. index.html or src/main)."* Four files
 * were overwritten, an `rm` was attempted on `src/`, the preview bridge was destroyed, the app was
 * left throwing `useState` of null — and ₹23.81 was charged. The user typed *"No parrot or no app,
 * don't work on any project"* to stop it.
 *
 * These pin BOTH halves: the trigger (an answer is never nudged) and the condition (a nudge can no
 * longer order a rewrite of an app that already exists).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideBuildNudge, turnAskedTheUser, turnDeclined, standDownNote } from '../src/server/AgentV3/nudgeToBuild';

const base = {
  expectsArtifacts: true,
  totalToolUses: 0,
  nudgesUsed: 0,
  maxNudges: 2,
  editingExistingApp: false,
};

/** The real first turn of build 95598899, as the report recorded it. */
const THE_REAL_ANSWER = `I notice there's a mismatch in the request. Earlier you asked me to build a Qiikr classifieds marketplace app, but now you're asking for a video of a parrot talking about fruits in Urdu.

Let me clarify: I can build the **Qiikr marketplace app** that you originally requested, but I cannot create videos or generate audio content. I can help you build the app with all the features you described (responsive UI, pay-to-list model, categories, search, filters, favorites, user profile, etc.).

Would you like me to:
1. **Continue building the Qiikr marketplace app** (which is what the project workspace already contains)?
2. **Or clarify if you need something different?**`;

/** The bug the nudge was built for, and which must keep working. */
const A_REAL_STALL = `Here's my plan for the notes app:

1. Create the entry point and mount React.
2. Add a NoteList component with add and delete.
3. Style it with a clean card layout.

Now I'll assign the frontend expert to create index.html.`;

describe('🔴 the exact turn that cost a user their app', () => {
  it('is NOT nudged — the engine no longer overrides it', () => {
    const d = decideBuildNudge({ ...base, text: THE_REAL_ANSWER });
    expect(d.nudge).toBe(false);
    expect(d.standDown).toBe('declined');
  });

  it('is recognised by BOTH independent tests, so losing either still catches it', () => {
    expect(turnDeclined(THE_REAL_ANSWER)).toBe(true);
    expect(turnAskedTheUser(THE_REAL_ANSWER)).toBe(true);
  });

  it('🔒 and the message that would have been sent is never produced for it', () => {
    expect(decideBuildNudge({ ...base, text: THE_REAL_ANSWER }).message).toBe('');
  });
});

describe('🔒 the nudge still does the job it was built for', () => {
  it('a model that narrates a plan and does nothing IS nudged', () => {
    const d = decideBuildNudge({ ...base, text: A_REAL_STALL });
    expect(d.nudge).toBe(true);
    expect(d.standDown).toBeUndefined();
    expect(d.message).toContain('ACT NOW');
  });

  it('⚠️ a rhetorical question mid-text does not disarm it — only the LAST line counts', () => {
    const d = decideBuildNudge({ ...base, text: 'Ready? Let me build it.\n\nI will start with the layout.' });
    expect(d.nudge).toBe(true);
  });

  it('it stops after the cap, exactly as before', () => {
    expect(decideBuildNudge({ ...base, text: A_REAL_STALL, nudgesUsed: 2 }).nudge).toBe(false);
    expect(decideBuildNudge({ ...base, text: A_REAL_STALL, nudgesUsed: 2 }).standDown).toBeUndefined();
  });

  it('a chat turn is never nudged, and a run that already used tools is not either', () => {
    expect(decideBuildNudge({ ...base, text: A_REAL_STALL, expectsArtifacts: false }).nudge).toBe(false);
    expect(decideBuildNudge({ ...base, text: A_REAL_STALL, totalToolUses: 3 }).nudge).toBe(false);
  });

  it('🔒 an INELIGIBLE turn reports no stand-down — it was never a decision to make', () => {
    // Otherwise the admin report would fill with "the engine declined to nudge" on every chat turn,
    // and a code that fires constantly is a code nobody reads.
    expect(decideBuildNudge({ ...base, text: THE_REAL_ANSWER, expectsArtifacts: false }).standDown).toBeUndefined();
  });
});

describe('🔒 a nudge can no longer order a rewrite of an existing app', () => {
  it('on a FRESH build it still names the entry file — that wording was right there', () => {
    const m = decideBuildNudge({ ...base, text: A_REAL_STALL }).message;
    expect(m).toContain('index.html or src/main');
  });

  it('🔴 on an EDIT it does not, and forbids replacing the app', () => {
    const m = decideBuildNudge({ ...base, text: A_REAL_STALL, editingExistingApp: true }).message;
    expect(m).not.toContain('index.html or src/main');
    expect(m).toContain('ALREADY EXISTS');
    expect(m).toContain('smallest targeted edit');
    expect(m).toMatch(/do\s+NOT rewrite, replace or delete/);
  });

  it('the edit wording still demands action — this is not a softer nudge', () => {
    expect(decideBuildNudge({ ...base, text: A_REAL_STALL, editingExistingApp: true }).message).toContain('ACT NOW');
  });
});

describe('the two detectors, at their edges', () => {
  it('a question is only an ask when it ENDS the turn', () => {
    expect(turnAskedTheUser('Which layout would you prefer?')).toBe(true);
    expect(turnAskedTheUser('Which layout would you prefer?\n\nI will use the grid.')).toBe(false);
  });

  it('cross-lingual question marks count — Urdu and full-width, not only ASCII', () => {
    expect(turnAskedTheUser('کیا آپ چاہتے ہیں کہ میں جاری رکھوں؟')).toBe(true);
    expect(turnAskedTheUser('要继续吗？')).toBe(true);
  });

  it('trailing whitespace and empty lines do not hide the question', () => {
    expect(turnAskedTheUser('Shall I continue?   \n\n   \n')).toBe(true);
  });

  it('empty, blank and absent text are not asks and not refusals', () => {
    for (const t of ['', '   \n\n', null, undefined]) {
      expect(turnAskedTheUser(t as string)).toBe(false);
      expect(turnDeclined(t as string)).toBe(false);
    }
  });

  it('🔒 the refusal test is the repo\'s ONE implementation, not a second copy', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/nudgeToBuild.ts'), 'utf8');
    expect(src).toContain("import { looksLikeRefusal } from '../lib/promptSafety'");
  });
});

describe('🔒 the wiring — a decision nothing calls is not a fix', () => {
  const code = (rel: string): string =>
    readFileSync(resolve(__dirname, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  it('the runner asks the decision instead of nudging unconditionally', () => {
    const runner = code('../src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('decideBuildNudge({');
    expect(runner).toContain('if (nudge.nudge) {');
    // REVERSION GUARD: the literal that was sent to a model looking at somebody's finished app.
    expect(runner).not.toContain("'the entry file (e.g. index.html or src/main). Output tool calls, not a description.',");
  });

  it('the route threads the edit signal, so the safer wording is LIVE and not dormant', () => {
    const route = code('../src/server/routes/agentv3.ts');
    expect(route).toContain('editingExistingApp: isEditMode,');
  });

  it('a stand-down reaches the admin report — otherwise it leaves no trace at all', () => {
    const route = code('../src/server/routes/agentv3.ts');
    expect(route).toContain('onNote:');
    expect(code('../src/server/AgentV3/AgentRunner.ts')).toContain("code: 'BUILD_NUDGE_STOOD_DOWN'");
  });

  it('⚠️ the note is admin-only and names no vendor — the White-Label Law reaches diagnostics text too', () => {
    for (const r of ['declined', 'asked-the-user'] as const) {
      const note = standDownNote(r);
      expect(note).not.toMatch(/GLM|Kimi|Claude|Gemini|Grok|OpenAI|Moonshot|Z\.ai/i);
      expect(note).toContain('2026-09-18');
    }
  });
});

describe('⚠️ the markdown case my own first draft missed', () => {
  it('a bold or quoted question still counts — models write markdown', () => {
    expect(turnAskedTheUser('**Or clarify if you need something different?**')).toBe(true);
    expect(turnAskedTheUser('2. *Should I continue?*')).toBe(true);
    expect(turnAskedTheUser('`Shall I proceed?`')).toBe(true);
    expect(turnAskedTheUser('"Do you want the dark theme?"')).toBe(true);
  });

  it('stripping the decoration does not invent a question where there is none', () => {
    expect(turnAskedTheUser('**I will now write the layout.**')).toBe(false);
    expect(turnAskedTheUser('Done.')).toBe(false);
    expect(turnAskedTheUser('***')).toBe(false);
  });
});
