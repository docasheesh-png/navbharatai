/**
 * A SHARED KEY MEANS THE PERSON — in every professional that declares it (review finding 2026-09-21).
 *
 * The shared identity (`SHARED_MEMORY_FIELDS`) is written and read by key NAME. Real-Estate AI declares
 * `location` = "City / area" — the PROPERTY's city — so by name alone a Delhi user looking at a flat in
 * Pune became "From: Pune" to every other expert. `MemoryField.shared: false` opts such a key out.
 *
 * This is a RATCHET over the registry: every field whose key is shared must either carry a label this
 * test already knows means the person, or say `shared` explicitly. A new config cannot re-open the
 * class silently — it fails here until its author decides.
 */
import { describe, it, expect } from 'vitest';
import { listProfessionals, getProfessional } from '../src/server/professionals/registry';
import { SHARED_MEMORY_FIELDS, sharedKeysFor } from '../src/server/professionals/clientMemory';

/** Labels that, in this registry today, mean the PERSON — reviewed by hand, extend deliberately. */
const PERSON_LABELS: Record<string, readonly string[]> = {
  name: ['Name', 'What to call them', 'Parent / what to call them', 'Owner / what to call them', 'Name / what to call them'],
  language: ['Prefers', 'Prefers to learn in', 'Prefers to be helped in'],
  location: ['From', 'Location', 'State / city / local body', 'State & district', 'Region'],
  occupation: ['Does'],
  remember: [],
};

const configs = listProfessionals().map((p) => getProfessional(p.id)!).filter((c) => c?.memory);

describe('every declared shared key either means the person or says otherwise', () => {
  it('the registry is what this test reads — not a copy', () => {
    expect(configs.length).toBeGreaterThan(60);
  });

  it('a shared-key field carries a known person-meaning label, or an explicit `shared`', () => {
    const undecided: string[] = [];
    for (const c of configs) {
      for (const f of c.memory!.fields) {
        if (!SHARED_MEMORY_FIELDS.some((s) => s.key === f.key)) continue;
        if (f.shared !== undefined) continue;
        if (!PERSON_LABELS[f.key]?.includes(f.label)) undecided.push(`${c.id}.${f.key} = "${f.label}"`);
      }
    }
    expect(undecided, 'decide `shared` for these fields (does the label mean the PERSON, or the domain?)').toEqual([]);
  });

  it('the two known domain meanings are opted out, and the opt-out is what sharedKeysFor reads', () => {
    for (const id of ['realestate_ai', 'business_ai']) {
      const c = getProfessional(id)!;
      expect(c.memory!.fields.find((f) => f.key === 'location')?.shared, id).toBe(false);
      expect(sharedKeysFor(c.memory!).has('location'), id).toBe(false);
      expect(sharedKeysFor(c.memory!).has('name'), id).toBe(true);
    }
    // …and a professional whose `location` means the person still shares it.
    expect(sharedKeysFor(getProfessional('teacher_ai')!.memory!).has('location')).toBe(true);
  });
});
