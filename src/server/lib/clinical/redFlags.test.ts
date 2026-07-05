import { describe, it, expect } from 'vitest';
import { detectRedFlags, detectRedFlagsAcross } from './redFlags';

describe('detectRedFlags — vital-sign thresholds parse the number (no leading-digit bug)', () => {
  it('does NOT flag NORMAL vitals (the false-emergency regression)', () => {
    // Old detector: "BP 120/80"→"20/"→Hypotension, "Hb 13"→Severe Anaemia, "SpO2 100%"→Low SpO2.
    const f = detectRedFlags('55/M. BP 120/80, Hb 13, SpO2 100%, pulse 78.');
    expect(f).not.toContain('Hypotension');
    expect(f).not.toContain('Severe Anaemia');
    expect(f).not.toContain('Low SpO2');
  });

  it('DOES flag genuinely dangerous vitals the old detector missed', () => {
    expect(detectRedFlags('BP 85/55 in a collapsed patient')).toContain('Hypotension'); // systolic 85 < 90
    expect(detectRedFlags('BP 130/55')).toContain('Hypotension');                        // diastolic 55 < 60
    expect(detectRedFlags('Hb 6.5 g/dL')).toContain('Severe Anaemia');                   // < 7
    expect(detectRedFlags('SpO2 88% on room air')).toContain('Low SpO2');                // < 90
  });

  it('boundary values: 90/90/7 are NOT emergencies; just under IS', () => {
    expect(detectRedFlags('SpO2 90%')).not.toContain('Low SpO2');
    expect(detectRedFlags('SpO2 89%')).toContain('Low SpO2');
    expect(detectRedFlags('BP 90/60')).not.toContain('Hypotension');
    expect(detectRedFlags('BP 89/60')).toContain('Hypotension');
    expect(detectRedFlags('Hb 7')).not.toContain('Severe Anaemia');
    expect(detectRedFlags('Hb 6.9')).toContain('Severe Anaemia');
  });

  it('does not mistake HbA1c for an Hb anaemia value', () => {
    expect(detectRedFlags('HbA1c 13')).not.toContain('Severe Anaemia');
  });

  it('still detects the word/phrase emergencies', () => {
    expect(detectRedFlags('shock with sepsis')).toEqual(expect.arrayContaining(['Shock', 'Sepsis']));
    expect(detectRedFlags('hypotension noted')).toContain('Hypotension');
    expect(detectRedFlags('severe anaemia')).toContain('Severe Anaemia');
  });

  it('detectRedFlagsAcross unions flags from multiple texts without cross-boundary matches', () => {
    const f = detectRedFlagsAcross('BP 85/55', 'Hb 6 and SpO2 85');
    expect(f).toEqual(expect.arrayContaining(['Hypotension', 'Severe Anaemia', 'Low SpO2']));
    // A "/" in one string must not combine with a number in another to fake a BP.
    expect(detectRedFlagsAcross('BP 120', '80')).not.toContain('Hypotension');
  });
});
