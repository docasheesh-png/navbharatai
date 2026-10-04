// Queue Q-087 (autopsy 52471441, admin-approved 2026-10-01): "Build a calculator" got no template,
// because only the starter chip's full text seeded one, so nothing was on screen at 38 s and the user
// pressed Stop. A request that is only a build verb plus one SIMPLE template's own name now gets that
// template; anything with one more word of spec still builds from scratch.
import { describe, expect, it } from 'vitest';
import {
  BARE_TEMPLATE_NAMES, GOLDEN_SCAFFOLDS, bareTemplateRequestFor, goldenScaffoldForPrompt,
} from '../src/server/AgentV3/goldenScaffolds/registry';

describe('a bare request names its template', () => {
  it('the report\'s own prompt gets the tested calculator', () => {
    expect(goldenScaffoldForPrompt('Build a calculator')?.id).toBe('calculator');
  });

  it.each([
    ['build a calculator', 'calculator'],
    ['Make me a calculator app.', 'calculator'],
    ['create a calculator please', 'calculator'],
    ['calculator banao', 'calculator'],
    ['ek calculator app bana do', 'calculator'],
    ['mujhe ek calculator chahiye', 'calculator'],
    ['build a todo app', 'todo'],
    ['make a to-do list', 'todo'],
    ['build a tip calculator', 'tip-split'],
    ['qr code generator banao', 'qr-generator'],
    ['build a memory game', 'memory'],
    ['gita app banao', 'geeta'],
    ['Build a GST bill maker', 'gst-bill'],
  ])('%s → %s', (prompt, id) => {
    expect(goldenScaffoldForPrompt(prompt)?.id).toBe(id);
  });

  it.each([
    'build a scientific calculator',
    'build a calculator with graphs',
    'build a calculator for kids',
    'calculator',                         // no order: could be a question
    'how do I build a calculator?',
    'build a calculator and a todo list',
    'build a notes app',                  // two templates could answer
    'build a timer',                      // two templates could answer
    'build a crm',                        // pro tier: the chip's spec is what extends it
    'build an online store',
    'fix the calculator',
    'build my calculator',
  ])('%s → no template', (prompt) => {
    expect(goldenScaffoldForPrompt(prompt)).toBeNull();
  });

  it('every name belongs to a SIMPLE scaffold, and no name is listed twice', () => {
    const seen = new Map<string, string>();
    for (const [id, names] of Object.entries(BARE_TEMPLATE_NAMES)) {
      const g = GOLDEN_SCAFFOLDS.find((s) => s.id === id);
      expect(g?.tier, id).toBe('simple');
      for (const n of names) {
        expect(n, `${n} is lowercase`).toBe(n.toLowerCase());
        expect(seen.get(n), `"${n}" is listed for ${seen.get(n)} and ${id}`).toBeUndefined();
        seen.set(n, id);
        expect(bareTemplateRequestFor(`build a ${n}`)?.id, n).toBe(id);
      }
    }
  });

  it('every simple scaffold can be asked for by name', () => {
    for (const g of GOLDEN_SCAFFOLDS.filter((s) => s.tier === 'simple')) {
      expect(BARE_TEMPLATE_NAMES[g.id]?.length ?? 0, g.id).toBeGreaterThan(0);
    }
  });
});
