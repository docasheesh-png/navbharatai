import { describe, it, expect, afterEach } from 'vitest';
import { voiceIdFor } from './SonicBridge';

describe('voiceIdFor — male/female voice selection', () => {
  const OLD = { m: process.env.SONIC_MALE_VOICE_ID, f: process.env.SONIC_FEMALE_VOICE_ID };
  afterEach(() => {
    if (OLD.m === undefined) delete process.env.SONIC_MALE_VOICE_ID; else process.env.SONIC_MALE_VOICE_ID = OLD.m;
    if (OLD.f === undefined) delete process.env.SONIC_FEMALE_VOICE_ID; else process.env.SONIC_FEMALE_VOICE_ID = OLD.f;
  });

  it('maps male → matthew and female → tiffany by default (Nova Sonic polyglot voices)', () => {
    delete process.env.SONIC_MALE_VOICE_ID;
    delete process.env.SONIC_FEMALE_VOICE_ID;
    expect(voiceIdFor('male')).toBe('matthew');
    expect(voiceIdFor('female')).toBe('tiffany');
  });

  it('lets each voice id be overridden by env (no redeploy to swap a voice)', () => {
    process.env.SONIC_MALE_VOICE_ID = 'carlos';
    process.env.SONIC_FEMALE_VOICE_ID = 'amy';
    expect(voiceIdFor('male')).toBe('carlos');
    expect(voiceIdFor('female')).toBe('amy');
  });
});
