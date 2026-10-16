// IT SAVES THE ANCHOR, NOT THE LOOK (Q-1031, found reviewing Q-986).
//
// 🔴 TWO SENTENCES, THREE LINES APART, SAYING OPPOSITE THINGS. The builder's system prompt has:
//
//     2. READ BEFORE WRITING: use read_file on every file you intend to change before
//        touching it. Never assume you know a file's current content from memory.
//
// and then, under rule 3:
//
//     To ADD content at the end of a file … Send old_string: "" exactly; no anchor and no read are needed.
//
// A model reading both had a flat contradiction to resolve by guessing — and the half that is wrong is the
// dangerous one. No read is needed to CONSTRUCT an anchor-free append; plenty is needed to know whether what
// you are appending is ALREADY THERE. On a fresh build the file is one we just wrote. On an EDIT build it is
// the user's app, and a blind append duplicates a rule, a function, or a whole section of it.
//
// 🧬 THE CLASS: a true statement about the MECHANICS of an operation, read as permission to skip the
// JUDGEMENT the operation still needs.
//
// ⚠️ THE ROW ASKED FOR A SECOND STRING — "an edit-mode form of the append sentence" — and that is declined
// with reason. Two strings for one rule is exactly the drift this module exists to end: the class came back
// FIVE times, each fix teaching one more branch of one more failure message. One sentence that is correct in
// both modes cannot disagree with itself, and there is only one place to change when it must change.
//
// 🔒 AND IT SAYS "know what is in it", NOT "read it". A blanket "read it" would have cost a 500-line read of
// the design kit on every CSS append — which the prompt deliberately avoids by LISTING the kit's classes
// instead. Supplied knowledge and a read answer the same question; demanding the read would have fixed a
// contradiction by creating a cost. That is the trap this test exists to hold shut.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPEND_WITH_EMPTY_OLD_STRING } from '../src/server/AgentV3/appendByEdit';
import { editModePrefix, architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

const root = join(__dirname, '..');

describe('🔴 the sentence no longer contradicts READ BEFORE WRITING', () => {
  it('it does not claim no read is needed', () => {
    expect(APPEND_WITH_EMPTY_OLD_STRING, 'the claim that collided with rule 2').not.toContain('no read');
    expect(APPEND_WITH_EMPTY_OLD_STRING).not.toMatch(/no anchor and no read/);
  });

  it('it still teaches the mechanics exactly — that half was never wrong', () => {
    expect(APPEND_WITH_EMPTY_OLD_STRING).toContain('old_string: ""');
    expect(APPEND_WITH_EMPTY_OLD_STRING).toMatch(/EMPTY old_string — it appends/);
    expect(APPEND_WITH_EMPTY_OLD_STRING, 'the anchor is still the thing you are spared').toContain('no anchor is needed');
  });

  it('…and it names the judgement the mechanics do not excuse', () => {
    expect(APPEND_WITH_EMPTY_OLD_STRING).toContain('ANCHOR, not the LOOK');
    expect(APPEND_WITH_EMPTY_OLD_STRING).toMatch(/content you did not write this turn/);
    expect(APPEND_WITH_EMPTY_OLD_STRING, 'the defect it prevents: a duplicated append on an edit build')
      .toMatch(/do not add something that is in there already/);
  });

  it('🔒 it says KNOW, not READ — a blanket read would cost the 500-line kit on every CSS append', () => {
    expect(APPEND_WITH_EMPTY_OLD_STRING).toContain('know what is in it');
    expect(APPEND_WITH_EMPTY_OLD_STRING, 'the listing is an accepted answer, not only a read')
      .toContain('use the listing this prompt already gives you');
    // Never the unconditional imperative, which is what would have created the cost.
    expect(APPEND_WITH_EMPTY_OLD_STRING).not.toMatch(/read it first anyway/);
  });
});

describe('🧭 both sentences reach the model, and they now agree', () => {
  // 🎯 THE COLLISION IS INSIDE ONE FUNCTION. `editModePrefix` — the prefix an EDIT build gets, which is what
  // the row said — carries rule 2 AND the append sentence, a few lines apart. That is as close as a
  // contradiction gets, and it is why the row is about an edit build specifically.
  const prompts = () => [
    ['editModePrefix', editModePrefix(['src/App.tsx', 'src/index.css'])],
    ['architect', architectSystemPrompt('vite-react')],
  ] as const;

  it('editModePrefix holds BOTH sentences — the collision, in one function', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('READ BEFORE WRITING');
    expect(p).toContain(APPEND_WITH_EMPTY_OLD_STRING);
    // And they are near enough that a model reads them together: rule 2, then rule 3's append line.
    const read = p.indexOf('READ BEFORE WRITING'), append = p.indexOf(APPEND_WITH_EMPTY_OLD_STRING);
    expect(append).toBeGreaterThan(read);
    expect(append - read, 'a few hundred characters apart, not pages').toBeLessThan(900);
  });

  it.each(prompts())('%s: nothing tells the model a read is unnecessary for an append', (_name, p) => {
    // The exact collision, in the assembled text a model actually receives.
    expect(p).not.toMatch(/no anchor and no read are needed/);
    expect(p).toContain(APPEND_WITH_EMPTY_OLD_STRING);
  });
});

describe('🧭 CLASS GUARD: one sentence, one home', () => {
  const SRC = readFileSync(join(root, 'src/server/AgentV3/appendByEdit.ts'), 'utf8');

  it('the module declares exactly one such sentence — no edit-mode twin', () => {
    const exported = [...SRC.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]);
    expect(exported, 'a second string for one rule is the drift this module exists to end')
      .toEqual(['APPEND_WITH_EMPTY_OLD_STRING']);
  });

  it('and every reader reads the constant, never a copy of its words', () => {
    // A hand-written copy somewhere else would go stale the moment this one changes — which is how the
    // class came back five times before it was centralised.
    const files = ['src/server/AgentV3/systemPrompt.ts', 'src/server/AgentV3/ToolDispatcher.ts',
      'src/server/AgentV3/CssConsistency.ts'];
    for (const f of files) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, `${f} must import the sentence`).toContain('APPEND_WITH_EMPTY_OLD_STRING');
      expect(src, `${f} must not spell it out`).not.toContain('it appends new_string to the');
    }
  });
});
