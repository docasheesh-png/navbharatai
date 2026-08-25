import { describe, it, expect } from 'vitest';
import {
  MEDICAL_PROFESSIONAL_IDS,
  isMedicalProfessionalId,
  medicalFeaturesHidden,
  visibleProfessionals,
  medicalViewBlocked,
} from './playCompliance';

// Google Play rejected the app update (2026-08-02, "Developer Account" — organization required for
// apps declaring medical features). The admin's chosen fix: the Play-distributed native shell hides
// every medical-class feature so the health declarations can truthfully say "none". These tests lock
// the gate so a future edit cannot silently re-expose a medical surface in the native app — which
// would turn the declarations into a deceptive-behaviour violation (account-level risk, not just a
// rejection).
describe('playCompliance — the native shell ships no medical features (admin 2026-08-04)', () => {
  const cards = [
    { id: 'sda_chat', label: 'Doctor AI' },
    { id: 'nbi_pro_chat', label: 'Pro v5.0' },
    { id: 'teacher_ai', label: 'Teacher AI' },
    { id: 'pharmacist_ai', label: 'Pharmacist' },
    { id: 'firstaid_ai', label: 'First Aid' },
    { id: 'maternity_ai', label: 'Pregnancy Care' },
    { id: 'lawyer_ai', label: 'Lawyer AI' },
  ];

  it('the medical set names exactly the four medical-class assistants', () => {
    expect([...MEDICAL_PROFESSIONAL_IDS].sort()).toEqual(['firstaid_ai', 'maternity_ai', 'pharmacist_ai', 'sda_chat']);
    expect(isMedicalProfessionalId('sda_chat')).toBe(true);
    expect(isMedicalProfessionalId('teacher_ai')).toBe(false);
  });

  it('hiding is active exactly in the native shell', () => {
    expect(medicalFeaturesHidden(true)).toBe(true);
    expect(medicalFeaturesHidden(false)).toBe(false);
  });

  it('native: the tile list drops all four medical entries and nothing else', () => {
    const shown = visibleProfessionals(cards, true).map((c) => c.id);
    expect(shown).toEqual(['nbi_pro_chat', 'teacher_ai', 'lawyer_ai']);
  });

  it('web: the tile list is untouched — byte-for-byte today\'s behaviour', () => {
    expect(visibleProfessionals(cards, false)).toEqual(cards);
  });

  it('blocks opening/rendering a medical view only in the native shell', () => {
    expect(medicalViewBlocked('sda_chat', true)).toBe(true);
    expect(medicalViewBlocked('pharmacist_ai', true)).toBe(true);
    expect(medicalViewBlocked('teacher_ai', true)).toBe(false);
    expect(medicalViewBlocked('sda_chat', false)).toBe(false);
  });

  // The Professionals HOME CARD was removed on 2026-08-25 (it moved into the Free chat's Mode
  // picker), and its copy helpers went with it — the picker filters by MEDICAL_PROFESSIONAL_IDS
  // directly, which the tests above already pin.
});
