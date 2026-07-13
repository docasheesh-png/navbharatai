import { describe, it, expect } from 'vitest';
import { isControlJson } from './SonicBridge';

describe('isControlJson — filters Nova Sonic control events out of the transcript', () => {
  it('flags JSON control objects (the leak the user saw)', () => {
    expect(isControlJson('{ "interrupted" : true }')).toBe(true);
    expect(isControlJson('{"interrupted":true}')).toBe(true);
    expect(isControlJson('  {"foo": 1}  ')).toBe(true);
  });

  it('keeps real speech text (never a JSON object)', () => {
    expect(isControlJson('नमस्ते! मैं NavBharatAI Voice हूँ।')).toBe(false);
    expect(isControlJson('The date is 13 July 2026.')).toBe(false);
    expect(isControlJson('{ this is not json')).toBe(false);
    expect(isControlJson('')).toBe(false);
    // A sentence that merely mentions braces is not a control object.
    expect(isControlJson('use {curly} braces')).toBe(false);
  });
});
