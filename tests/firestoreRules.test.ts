import { describe, it, expect } from 'vitest';
import { SECURE_FIRESTORE_RULES, firestoreRulesConsoleUrl, rulesAreWideOpen, FIRESTORE_RULES_STEPS } from '../src/lib/firestoreRules';

describe('firestoreRules', () => {
  it('default rules are not wide open and end with a deny-all', () => {
    expect(rulesAreWideOpen(SECURE_FIRESTORE_RULES)).toBe(false);
    expect(SECURE_FIRESTORE_RULES).toContain("rules_version = '2'");
    expect(SECURE_FIRESTORE_RULES).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
    expect(SECURE_FIRESTORE_RULES).toContain('request.auth.uid == uid');
  });
  it('detects test-mode rules', () => {
    expect(rulesAreWideOpen('allow read, write;')).toBe(true);
    expect(rulesAreWideOpen('allow read, write: if true;')).toBe(true);
    expect(rulesAreWideOpen('allow read, write: if request.time < timestamp.date(2026, 1, 1);')).toBe(true);
  });
  it('deep-links only a plausible project id', () => {
    expect(firestoreRulesConsoleUrl('my-shop-123')).toBe('https://console.firebase.google.com/project/my-shop-123/firestore/rules');
    expect(firestoreRulesConsoleUrl('../evil')).toBe('https://console.firebase.google.com/');
    expect(firestoreRulesConsoleUrl('')).toBe('https://console.firebase.google.com/');
  });
  it('has bilingual steps', () => {
    for (const s of FIRESTORE_RULES_STEPS) { expect(s.en).toBeTruthy(); expect(s.hi).toBeTruthy(); }
  });
});
