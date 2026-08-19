// Tests for Doctor AI's report memory (admin 2026-08-18) — the fix for the real transcript where the
// doctor asked "ecg me lead V2 dekh ke batao" and Doctor AI answered it could not see the image.

import { describe, it, expect } from 'vitest';
import { SessionReportStore, isVisionReportType, referencesAttachedReport } from './reportMemory';

const NOW = 1_000_000;
const HOURS = 60 * 60 * 1000;

describe('referencesAttachedReport — does the follow-up ask about the report?', () => {
  it('matches the REAL reported follow-up (Hinglish, lead V2)', () => {
    expect(referencesAttachedReport('ecg me lead v2 dekh ke batao kya yeh theek hai')).toBe(true);
  });

  it('matches English and Hinglish report questions across modalities', () => {
    for (const q of [
      'please analyse this ecg and make a diagnosis',
      'what about the ST segment in lead III?',
      'is xray me fracture hai kya?',
      'usg report me liver kaisa hai',
      'check the costophrenic angle',
      'QRS morphology in V1 batao',
      'is scan me opacity dikh rahi hai?',
      'isme kya problem hai',
    ]) {
      expect(referencesAttachedReport(q), q).toBe(true);
    }
  });

  it('does NOT match unrelated clinical talk — no wasted vision call', () => {
    for (const q of [
      'patient ko paracetamol kitna dun?',
      'thank you',
      'what is the dose of amoxicillin for a 20kg child',
      'refer kar dun kya higher centre?',
    ]) {
      expect(referencesAttachedReport(q), q).toBe(false);
    }
  });

  it('is safe on empty input', () => {
    expect(referencesAttachedReport('')).toBe(false);
  });
});

describe('isVisionReportType', () => {
  it('accepts images and PDFs; rejects extracted-to-text document types', () => {
    expect(isVisionReportType('image/jpeg')).toBe(true);
    expect(isVisionReportType('image/png')).toBe(true);
    expect(isVisionReportType('application/pdf')).toBe(true);
    expect(isVisionReportType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(isVisionReportType('text/plain')).toBe(false);
    expect(isVisionReportType('')).toBe(false);
  });
});

describe('SessionReportStore', () => {
  const FILE = { fileData: 'base64bytes', fileType: 'image/jpeg', fileName: 'ecg.jpg' };

  it('remembers a report and hands the SAME bytes back for a follow-up', () => {
    const store = new SessionReportStore();
    store.remember('s1', FILE, NOW);
    expect(store.latest('s1', NOW + 5 * 60 * 1000)).toEqual(FILE);
  });

  it('the newest report wins when several were sent, capped at three per session', () => {
    const store = new SessionReportStore();
    for (let i = 1; i <= 5; i++) {
      store.remember('s1', { fileData: `b${i}`, fileType: 'image/png', fileName: `r${i}.png` }, NOW + i);
    }
    expect(store.latest('s1', NOW + 10)?.fileName).toBe('r5.png');
  });

  it('expires after the 24h session TTL — a stale report is never silently re-used', () => {
    const store = new SessionReportStore();
    store.remember('s1', FILE, NOW);
    expect(store.latest('s1', NOW + 25 * HOURS)).toBeNull();
  });

  it('sessions are isolated — one doctor’s report never reaches another session', () => {
    const store = new SessionReportStore();
    store.remember('s1', FILE, NOW);
    expect(store.latest('s2', NOW)).toBeNull();
  });

  it('never stores a non-vision type or an empty payload', () => {
    const store = new SessionReportStore();
    store.remember('s1', { fileData: 'x', fileType: 'text/plain', fileName: 'notes.txt' }, NOW);
    store.remember('s1', { fileData: '', fileType: 'image/png', fileName: 'empty.png' }, NOW);
    expect(store.latest('s1', NOW)).toBeNull();
  });

  it('sweep drops expired sessions', () => {
    const store = new SessionReportStore();
    store.remember('s1', FILE, NOW);
    store.remember('s2', FILE, NOW + 20 * HOURS);
    store.sweep(NOW + 25 * HOURS);
    expect(store.latest('s1', NOW + 25 * HOURS)).toBeNull();
    expect(store.latest('s2', NOW + 25 * HOURS)).not.toBeNull();
  });
});
