import { describe, it, expect } from 'vitest';
import {
  extractJson,
  buildSuggestionPrompt,
  parseSuggestions,
  buildPalettePrompt,
  parsePalette,
  aiSuggestions,
  aiPalette,
} from '../src/server/AgentV3/DesignAdvisor';

/** P-DESIGN.5 — AI design pass (pure builders + parsers; AI calls via a fake router). */

describe('DesignAdvisor — extractJson', () => {
  it('pulls a JSON array out of fenced markdown', () => {
    expect(extractJson('```json\n[{"a":1}]\n```', 'array')).toBe('[{"a":1}]');
  });
  it('pulls a JSON object out of surrounding prose', () => {
    expect(extractJson('Here you go: {"x": 1} cheers', 'object')).toBe('{"x": 1}');
  });
  it('returns empty when no JSON present', () => {
    expect(extractJson('no json here', 'array')).toBe('');
  });
});

describe('DesignAdvisor — buildSuggestionPrompt', () => {
  it('includes the code and asks for a JSON array', () => {
    const p = buildSuggestionPrompt('const x = 1;');
    expect(p).toContain('const x = 1;');
    expect(p).toContain('JSON array');
  });
  it('handles empty code', () => {
    expect(buildSuggestionPrompt('')).toContain('No code yet');
  });
});

describe('DesignAdvisor — parseSuggestions', () => {
  it('parses + validates + caps suggestions', () => {
    const text = '```json\n' + JSON.stringify([
      { label: 'Add auth', prompt: 'Add login/signup', category: 'add' },
      { label: 'Fix layout', prompt: 'Fix the broken grid', category: 'fix' },
      { label: 'no prompt' }, // dropped
      { label: 'Weird cat', prompt: 'do it', category: 'nonsense' }, // category → improve
    ]) + '\n```';
    const out = parseSuggestions(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ label: 'Add auth', prompt: 'Add login/signup', category: 'add' });
    expect(out[2].category).toBe('improve');
  });
  it('returns [] on garbage', () => {
    expect(parseSuggestions('not json')).toEqual([]);
    expect(parseSuggestions('{"not":"an array"}')).toEqual([]);
  });
});

describe('DesignAdvisor — parsePalette', () => {
  it('validates hex colours and keeps a type scale', () => {
    const text = JSON.stringify({
      colors: { primary: '#4f46e5', text: '#ffffff', bad: 'notacolor' },
      typeScale: { base: '16px', xl: '28px' },
    });
    const p = parsePalette(text)!;
    expect(p.colors.primary).toBe('#4f46e5');
    expect(p.colors.text).toBe('#ffffff');
    expect(p.colors.bad).toBeUndefined(); // invalid hex dropped
    expect(p.typeScale.base).toBe('16px');
  });
  it('returns null when no valid colours', () => {
    expect(parsePalette('{"colors":{"x":"nope"}}')).toBeNull();
    expect(parsePalette('garbage')).toBeNull();
  });
});

describe('DesignAdvisor — buildPalettePrompt', () => {
  it('includes the brand and asks for a JSON object', () => {
    const p = buildPalettePrompt('calm fintech, trustworthy blue');
    expect(p).toContain('calm fintech');
    expect(p).toContain('JSON object');
  });
});

describe('DesignAdvisor — aiSuggestions / aiPalette (with a fake router)', () => {
  const fakeRoute = (content: string) => async () => ({ response: { content } });

  it('aiSuggestions returns parsed suggestions from the router', async () => {
    const out = await aiSuggestions('code', fakeRoute('[{"label":"X","prompt":"do x","category":"style"}]'));
    expect(out).toEqual([{ label: 'X', prompt: 'do x', category: 'style' }]);
  });
  it('aiSuggestions returns [] when the router throws', async () => {
    const out = await aiSuggestions('code', async () => { throw new Error('down'); });
    expect(out).toEqual([]);
  });
  it('aiPalette returns a validated palette', async () => {
    const out = await aiPalette('brand', fakeRoute('{"colors":{"primary":"#000000"}}'));
    expect(out?.colors.primary).toBe('#000000');
  });
  it('aiPalette returns null when the router throws', async () => {
    expect(await aiPalette('brand', async () => { throw new Error('down'); })).toBeNull();
  });
});
