// THE SENTENCE MATCHES THE COUNTER (Q-1023, found reviewing Q-992).
//
// 🔴 A SENTENCE THAT CLAIMED TO BE GENERATED FROM THE CODE, WHERE ONLY ITS NUMBERS WERE. `NO_READABLE_SCOPE`
// is what a user is told when the sizer finds no readable scope, and its own doc comment said it was
// "generated from the two constants the counter really uses, so the sentence cannot drift from the code."
// The constants were interpolated. The RULES were hand-written prose — and they had drifted.
//
// Measured against `countEnumeratedFeatures` itself, "each bullet or numbered line counts one" is false in
// FOUR ways, and the fourth is the one the row never mentioned:
//
//     - name / - email / - phone number        → 0   field names are not features (RECORD_ATTRIBUTE)
//     - modern / - clean / - fast              → 0   style adjectives (STYLE_ADJECTIVE)
//     - login / - login / - login              → 1   repeats collapse
//     three bullets of 10+ words each          → 0   MAX_ITEM_WORDS — a LONG bullet counts NOTHING
//
// That last one is what a careful user hits: write DETAILED bullets, and the sizer reads no scope at all,
// while the sentence tells them each bullet counted one. The row named the first three.
//
// 🧬 THE CLASS: prose that describes a rule, living apart from the rule. It cannot be fixed by editing the
// prose once — it will drift again — so this test holds each measured case against the sentence, and the
// sentence is built from the module's own constants.
//
// ⚠️ THE COUNTER IS NOT CHANGED HERE. Whether a careful 10-word bullet should really count zero is a product
// question that moves routing for real builds; it is Q-1128, not a silent edit inside a wording fix.
import { describe, it, expect } from 'vitest';
import { NO_READABLE_SCOPE, statesAScope } from '../src/server/AgentV3/complexityRouting';
import { countEnumeratedFeatures, MAX_ITEM_WORDS, MIN_RUN_ITEMS } from '../src/server/AgentV3/enumeratedFeatures';

/** The measured cases, exactly as run against the counter. Each is a claim the sentence must not contradict. */
const CASES: Array<{ label: string; prompt: string; counts: number }> = [
  { label: 'three plain features', prompt: '- paste a link\n- stream videos\n- no ads', counts: 3 },
  { label: 'three record attributes', prompt: '- name\n- email\n- phone number', counts: 0 },
  { label: 'three style adjectives', prompt: '- modern\n- clean\n- fast', counts: 0 },
  { label: 'three repeats', prompt: '- login\n- login\n- login', counts: 1 },
  {
    label: 'three long bullets',
    prompt: '- a page where the user can paste a link to add a video\n'
      + '- another rather long line of words here\n- and a third quite long one too',
    counts: 0,
  },
  { label: 'two attributes and two features', prompt: '- name\n- email\n- stream videos\n- no ads', counts: 2 },
];

describe('🔴 the counter still does exactly what was measured', () => {
  it.each(CASES.map((c) => [c.label, c.prompt, c.counts] as const))('%s → %i', (_l, prompt, counts) => {
    // If one of these numbers changes, the counter changed and the SENTENCE must be re-checked against it —
    // that is the point of pinning them here rather than in prose.
    expect(countEnumeratedFeatures(prompt)).toBe(counts);
  });
});

describe('🔴 the sentence names every dropper that can make the count zero', () => {
  it('a field name', () => {
    expect(countEnumeratedFeatures('- name\n- email\n- phone number')).toBe(0);
    expect(NO_READABLE_SCOPE, 'three bullets of field names count zero — say so').toContain('a field name');
  });

  it('a style adjective', () => {
    expect(countEnumeratedFeatures('- modern\n- clean\n- fast')).toBe(0);
    expect(NO_READABLE_SCOPE).toContain('a style adjective');
  });

  it('a repeat', () => {
    expect(countEnumeratedFeatures('- login\n- login\n- login')).toBe(1);
    expect(NO_READABLE_SCOPE).toContain('a repeat of an earlier item');
  });

  it('🔴 a longer phrase — the dropper the row never mentioned', () => {
    const long = CASES.find((c) => c.label === 'three long bullets')!;
    expect(countEnumeratedFeatures(long.prompt)).toBe(0);
    expect(NO_READABLE_SCOPE, 'a DETAILED bullet counts nothing, and that is the surprising one')
      .toContain('a longer phrase is not counted');
    expect(NO_READABLE_SCOPE, 'and the real limit is named, from the module').toContain(`at most ${MAX_ITEM_WORDS} words`);
  });

  it('…and it no longer claims every bullet counts', () => {
    expect(NO_READABLE_SCOPE, 'the false clause').not.toContain('each bullet or numbered line counts one');
    expect(NO_READABLE_SCOPE).toContain('counts one only if');
  });
});

describe('🔒 the numbers come from the module, not from a retyped literal', () => {
  it('both constants appear as their real values', () => {
    expect(NO_READABLE_SCOPE).toContain(`at most ${MAX_ITEM_WORDS} words`);
    expect(NO_READABLE_SCOPE).toContain(`a run of ${MIN_RUN_ITEMS} or more`);
  });

  it('and the inline-run and sentence rules it already had are kept', () => {
    expect(NO_READABLE_SCOPE).toContain('inline items count only in a run of');
    expect(NO_READABLE_SCOPE).toContain('a feature described in a sentence is not counted');
    expect(NO_READABLE_SCOPE).toContain('no big-software noun');
  });

  it('PRECISION: a request that DOES state a scope never reaches this sentence', () => {
    // The sentence is only true of a request the sizer could not read. A big-software noun or enough
    // countable features means it was read — so the wording is never shown for those.
    expect(statesAScope('build me an ERP')).toBe(true);
    expect(statesAScope('- paste a link\n- stream videos\n- no ads')).toBe(true);
    expect(statesAScope('- name\n- email\n- phone number'), 'field names are not a scope').toBe(false);
    expect(statesAScope('Make biology learning app'), "1be16985's request, the one it was written for").toBe(false);
  });
});
