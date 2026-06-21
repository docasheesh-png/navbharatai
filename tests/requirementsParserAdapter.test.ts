import { describe, it, expect } from 'vitest';
import { RequirementsParserAdapter } from '../src/server/AppMakerLab/RequirementsParserAdapter';

describe('RequirementsParserAdapter.parse', () => {
  it('returns an object with the original prompt preserved', () => {
    const result = RequirementsParserAdapter.parse('build a todo app');
    expect(result.prompt).toBe('build a todo app');
  });

  it('generates an id starting with "req_"', () => {
    const result = RequirementsParserAdapter.parse('test');
    expect(result.id).toMatch(/^req_\d+$/);
  });

  it('sets a numeric timestamp', () => {
    const result = RequirementsParserAdapter.parse('test');
    expect(typeof result.timestamp).toBe('number');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('includes an empty metadata object', () => {
    const result = RequirementsParserAdapter.parse('test');
    expect(result.metadata).toEqual({});
  });

  it('two parses of the same prompt produce distinct ids (time-based)', async () => {
    const r1 = RequirementsParserAdapter.parse('same');
    await new Promise(r => setTimeout(r, 2));
    const r2 = RequirementsParserAdapter.parse('same');
    expect(r1.id).not.toBe(r2.id);
  });
});
