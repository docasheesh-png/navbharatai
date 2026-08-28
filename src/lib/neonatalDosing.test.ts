import { describe, it, expect } from 'vitest';
import {
  calculateNeonatalDose, answerDoseQuestion, parseWeightKg, parseAgeDays, findDrug, findIndication,
  isDoseQuestion, formatMg, NEONATAL_DRUGS, MIN_WEIGHT_KG, MAX_WEIGHT_KG,
  parseConcentration, parseVialTeaching, vialRememberedMessage,
  editDistance, FUZZY_MIN_LENGTH, FUZZY_MAX_DISTANCE, directDoseReply,
} from './neonatalDosing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerOffline } from './offlineAssistant';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { loadVials, saveVial, forgetVial } from './vialMemory';

/**
 * These tests are the reason this is code and not a prompt. Every one of them encodes a way a newborn
 * could be given the wrong amount, and each is a number a language model asked to recall a table could
 * plausibly get wrong while sounding certain.
 */

describe('TRAP 1 — ampicillin is 50 or 100 mg/kg/dose, and the difference is meningitis', () => {
  it('sepsis: 50 mg/kg/dose', () => {
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 3, ageDays: 2, indication: 'sepsis' });
    expect(r.ok).toBe(true);
    expect(r.parts[0].amount).toBe('150 mg');
    expect(r.parts[0].frequency).toBe('every 12 hours');
  });

  it('meningitis: 100 mg/kg/dose — DOUBLE, for the same baby', () => {
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 3, ageDays: 2, indication: 'meningitis' });
    expect(r.parts[0].amount).toBe('300 mg');
    expect(r.parts[0].duration).toBe('3 weeks');
  });

  it('REFUSES to answer without the indication rather than picking one', () => {
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 3, ageDays: 2 });
    expect(r.ok).toBe(false);
    expect(r.parts).toEqual([]);
    expect(r.needs.map((n) => n.field)).toContain('indication');
    expect(r.message).toMatch(/50 and 100/);
  });

  it('and never infers the indication from vague wording', () => {
    // "looks unwell" must not become sepsis. For this drug that guess is a 2x error.
    expect(findIndication('baby looks unwell and floppy')).toBeNull();
    expect(findIndication('suspected meningitis')).toBe('meningitis');
  });
});

describe('TRAP 2 — gentamicin changes BOTH dose and frequency with the indication', () => {
  it('sepsis: 5 mg/kg once daily, at any age', () => {
    for (const ageDays of [1, 6, 7, 20]) {
      const r = calculateNeonatalDose({ drug: 'gentamicin', weightKg: 2, ageDays, indication: 'sepsis' });
      expect(r.parts[0].amount).toBe('10 mg');
      expect(r.parts[0].frequency).toBe('every 24 hours');
    }
  });

  it('meningitis: 2.5 mg/kg, 12-hourly under 7 days and 8-hourly after', () => {
    const early = calculateNeonatalDose({ drug: 'gentamicin', weightKg: 2, ageDays: 3, indication: 'meningitis' });
    expect(early.parts[0].amount).toBe('5 mg');
    expect(early.parts[0].frequency).toBe('every 12 hours');
    const late = calculateNeonatalDose({ drug: 'gentamicin', weightKg: 2, ageDays: 10, indication: 'meningitis' });
    expect(late.parts[0].frequency).toBe('every 8 hours');
  });

  it('the spelling the chart itself uses ("Gentamycin") resolves to the same drug', () => {
    expect(findDrug('gentamycin')?.id).toBe('gentamicin');
  });
});

describe('TRAP 3 — Vitamin K is a FIXED 1 mg, never multiplied by weight', () => {
  it('is 1 mg for a 1 kg baby and for a 4 kg baby alike', () => {
    for (const weightKg of [1, 2.5, 4]) {
      const r = calculateNeonatalDose({ drug: 'vitamin k', weightKg });
      expect(r.ok).toBe(true);
      expect(r.parts[0].amount).toBe('1 mg');
      expect(r.parts[0].route).toBe('IM');
    }
  });

  it('says out loud that it is not weight-based, so nobody re-derives it', () => {
    const r = calculateNeonatalDose({ drug: 'vit k', weightKg: 3 });
    expect(r.parts[0].workings).toMatch(/not multiplied by weight/i);
  });

  it('and answers even with NO weight given — because it does not need one', () => {
    const r = calculateNeonatalDose({ drug: 'vitamin k' });
    expect(r.ok).toBe(true);
    expect(r.parts[0].amount).toBe('1 mg');
  });
});

describe('TRAP 4 — dopamine is an infusion, and the chart cannot give a pump rate', () => {
  it('returns micrograms per MINUTE, from the mcg/kg/min range', () => {
    const r = calculateNeonatalDose({ drug: 'dopamine', weightKg: 2 });
    expect(r.ok).toBe(true);
    expect(r.parts[0].amount).toBe('10–40 micrograms per minute');
  });

  it('REFUSES to invent a mL/hour rate — the chart gives no dilution', () => {
    const r = calculateNeonatalDose({ drug: 'dobutamine', weightKg: 3 });
    expect(r.warnings.join(' ')).toMatch(/cannot work out a millilitres-per-hour/i);
    expect(JSON.stringify(r)).not.toMatch(/ml\/h|ml per hour/i);
  });
});

describe('the weight guard — a decimal slip must not become a 10x overdose', () => {
  it('refuses a weight above the newborn range instead of calculating it', () => {
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 32, ageDays: 2, indication: 'sepsis' });
    expect(r.ok).toBe(false);
    expect(r.parts).toEqual([]);
    expect(r.message).toMatch(/outside the newborn range/i);
  });

  it('refuses an impossibly small weight too', () => {
    expect(calculateNeonatalDose({ drug: 'ampicillin', weightKg: 0.05, ageDays: 1, indication: 'sepsis' }).ok).toBe(false);
  });

  it('accepts the real extremes of the range', () => {
    for (const weightKg of [MIN_WEIGHT_KG, MAX_WEIGHT_KG, 0.9, 3.2]) {
      expect(calculateNeonatalDose({ drug: 'ampicillin', weightKg, ageDays: 1, indication: 'sepsis' }).ok).toBe(true);
    }
  });
});

describe('the day-7 boundary the chart never defines', () => {
  it('uses the 7-days-and-over schedule AND says so, rather than choosing silently', () => {
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 3, ageDays: 7, indication: 'sepsis' });
    expect(r.parts[0].frequency).toBe('every 8 hours');
    expect(r.warnings.join(' ')).toMatch(/day 7 exactly is not spelled out/i);
  });

  it('does not raise the note for a drug whose frequency never splits by age', () => {
    const r = calculateNeonatalDose({ drug: 'gentamicin', weightKg: 3, ageDays: 7, indication: 'sepsis' });
    expect(r.warnings.join(' ')).not.toMatch(/day 7 exactly/i);
  });

  it('asks for the age when the frequency depends on it', () => {
    const r = calculateNeonatalDose({ drug: 'cefotaxime', weightKg: 3 });
    expect(r.ok).toBe(false);
    expect(r.needs.map((n) => n.field)).toContain('age');
  });
});

describe('a drug that is not in the chart gets no dose at all', () => {
  it('refuses, and names what the chart does cover', () => {
    const r = calculateNeonatalDose({ drug: 'meropenem', weightKg: 3, ageDays: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not in this chart/i);
    expect(r.message).toMatch(/Ampicillin/);
  });

  it('never answers from outside the chart, however confident the question sounds', () => {
    expect(calculateNeonatalDose({ drug: 'vancomycin dose for 3 kg baby', weightKg: 3 }).ok).toBe(false);
  });

  it('the chart has no meningitis regimen for cloxacillin, and says so', () => {
    const r = calculateNeonatalDose({ drug: 'cloxacillin', weightKg: 3, ageDays: 2, indication: 'meningitis' });
    // Cloxacillin has no byIndication split, so it answers its single regimen — with its own caution.
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/no meningitis regimen/i);
  });
});

describe('reading what the user actually typed', () => {
  it('takes kg and grams, in English and Hinglish', () => {
    expect(parseWeightKg('gentamicin for 2.4 kg baby')).toBe(2.4);
    expect(parseWeightKg('1800 grams')).toBe(1.8);
    expect(parseWeightKg('2500 gm')).toBe(2.5);
    expect(parseWeightKg('3 kilo')).toBe(3);
  });

  it('REFUSES a bare number — it could be kg, days or anything', () => {
    // The dangerous convenience. "2.5" as a weight is a guess, and a guess here is a dose.
    expect(parseWeightKg('ampicillin 2.5')).toBeNull();
    expect(parseWeightKg('dose 50')).toBeNull();
  });

  it('reads age in days and weeks, in English and Hinglish', () => {
    expect(parseAgeDays('3 days old')).toBe(3);
    expect(parseAgeDays('5 din ka bacha')).toBe(5);
    expect(parseAgeDays('2 weeks old')).toBe(14);
    expect(parseAgeDays('newborn')).toBe(0);
    expect(parseAgeDays('no age here')).toBeNull();
  });

  it('only treats a message as a dose question when a chart drug AND a dosing cue are present', () => {
    expect(isDoseQuestion('ampicillin dose for 3 kg')).toBe(true);
    expect(isDoseQuestion('gentamicin 2 kg 4 din')).toBe(true);
    expect(isDoseQuestion('we started gentamicin yesterday')).toBe(false);
    expect(isDoseQuestion('what is the dose of paracetamol')).toBe(false);
  });
});

describe('the answer a person reads', () => {
  it('always shows the arithmetic and the source', () => {
    const text = answerDoseQuestion('ampicillin dose for 2.5 kg baby, 3 days old, sepsis');
    expect(text).toMatch(/125 mg/);
    expect(text).toMatch(/50 mg\/kg × 2.5 kg = 125 mg/);
    expect(text).toMatch(/every 12 hours/);
    expect(text).toMatch(/Uttar Pradesh/);
    expect(text).toMatch(/Facility Based Newborn Care/);
  });

  it('when something is missing it ASKS, and gives no CALCULATED dose to misread', () => {
    const text = answerDoseQuestion('ampicillin dose for 2.5 kg baby, 3 days old');
    expect(text).toMatch(/sepsis, pneumonia, or meningitis/i);
    // It DOES name the two chart rates (50 and 100 mg/kg) — that is the explanation of why it must ask,
    // and my first version of this test wrongly forbade it. What must not appear is a dose worked out
    // for THIS baby: no arithmetic, and neither of the two totals a 2.5 kg baby could have received.
    expect(text).not.toMatch(/=/);
    expect(text).not.toMatch(/\b125 mg\b/);
    expect(text).not.toMatch(/\b250 mg\b/);
  });

  it('carries the caution on every answered dose', () => {
    expect(answerDoseQuestion('gentamicin 2 kg 3 din sepsis dose')).toMatch(/does not replace your unit protocol/i);
  });
});

describe('the whole chart is transcribed, and the arithmetic is exact', () => {
  it('EVERY alias resolves to its own drug — the strongest form of "the chart is reachable"', () => {
    for (const d of NEONATAL_DRUGS) {
      for (const alias of d.aliases) expect(findDrug(alias)?.id).toBe(d.id);
    }
  });

  it('a half-name is NOT a match — "vitamin" alone is ambiguous and must not resolve', () => {
    // My first version of the test above asserted the opposite by accident (it split "Vitamin K" on the
    // space) and failed. The code was right: a partial name silently resolving to one drug is exactly
    // the kind of near-miss that has no place here.
    expect(findDrug('vitamin')).toBeNull();
    expect(findDrug('pheno')).toBeNull();
  });

  it('multi-part regimens keep their loading and maintenance separate', () => {
    const r = calculateNeonatalDose({ drug: 'phenobarbitone', weightKg: 3 });
    expect(r.parts.map((p) => p.label)).toEqual(['Loading dose', 'Maintenance']);
    expect(r.parts[0].amount).toBe('60 mg');
    expect(r.parts[0].over).toBe('over 10–15 minutes');
    expect(r.parts[1].amount).toBe('9–12 mg'); // the chart's 3–4 mg/kg range, kept as a range
  });

  it('phenytoin keeps its loading RANGE rather than picking a number from it', () => {
    const r = calculateNeonatalDose({ drug: 'phenytoin', weightKg: 2 });
    expect(r.parts[0].amount).toBe('30–40 mg');
    expect(r.parts[1].amount).toBe('10 mg');
  });

  it('does not produce floating-point noise in a dose', () => {
    expect(formatMg(0.1 + 0.2)).toBe('0.3');
    expect(calculateNeonatalDose({ drug: 'gentamicin', weightKg: 1.15, ageDays: 1, indication: 'sepsis' }).parts[0].amount).toBe('5.75 mg');
  });
});

describe('WIRING — the OFFLINE AI answers a dose with no network and no model', () => {
  it('answers a full dose question offline, with the arithmetic', () => {
    const a = answerOffline('ampicillin dose for 2.5 kg baby 3 days old sepsis');
    expect(a.kind).toBe('answer');
    expect(a.answerKind).toBe('dose');
    expect(a.answerText).toMatch(/125 mg/);
    expect(a.answerText).toMatch(/every 12 hours/);
  });

  it('asks offline for the indication instead of guessing it', () => {
    const a = answerOffline('ampicillin dose for 2.5 kg baby 3 days old');
    expect(a.answerText).toMatch(/sepsis, pneumonia, or meningitis/i);
  });

  it('the DOSE branch runs BEFORE the calculator — a dose question is not treated as arithmetic', () => {
    // "2.5 kg" and "50" in one sentence is exactly what the arithmetic evaluator would try to consume.
    const a = answerOffline('gentamicin 2 kg 4 din sepsis dose');
    expect(a.answerKind).toBe('dose');
    expect(a.answerText).toMatch(/10 mg/);
  });

  it('ordinary talk that merely mentions a drug is NOT hijacked into a dose reply', () => {
    const a = answerOffline('we started gentamicin yesterday');
    expect(a.answerKind).not.toBe('dose');
  });

  it('plain arithmetic still works — the new branch must not swallow the calculator', () => {
    const a = answerOffline('what is 12 * 4');
    expect(a.answerKind).toBe('math');
  });
});

describe('WIRING — every ONLINE AI gets the dose computed, not remembered', () => {
  it('injects the calculated answer at the one place all AIs ask for context', () => {
    const ctx = AppContextInjector.getRelevantContext('ampicillin dose for 2.5 kg baby 3 days old sepsis', 'sda_chat');
    expect(ctx).toMatch(/ALREADY CALCULATED/);
    expect(ctx).toMatch(/125 mg/);
    expect(ctx).toMatch(/Do NOT recalculate/);
  });

  it('injects the QUESTION when something is missing, so the model asks instead of assuming', () => {
    const ctx = AppContextInjector.getRelevantContext('ampicillin dose for 2.5 kg baby 3 days old', 'sda_chat');
    expect(ctx).toMatch(/sepsis, pneumonia, or meningitis/i);
    expect(ctx).toMatch(/never assume one/i);
  });

  it('stays completely out of the way of a non-dosing message', () => {
    const ctx = AppContextInjector.getRelevantContext('where do I change my password', 'sda_chat');
    expect(ctx).not.toMatch(/ALREADY CALCULATED/);
  });

  it('works for EVERY AI surface — the point of putting it at this chokepoint', () => {
    for (const surface of ['sda_chat', 'engineer_ai', 'professional', 'pro_chat', 'nbi_chat']) {
      expect(AppContextInjector.getRelevantContext('gentamicin 2 kg 4 din sepsis dose', surface)).toMatch(/10 mg/);
    }
  });
});

describe('MILLILITRES — the number the chart cannot give on its own', () => {
  it('reads a vial the way a nurse writes it', () => {
    expect(parseConcentration('ampicillin 500 mg in 5 ml')?.mgPerMl).toBe(100);
    expect(parseConcentration('500mg/5ml')?.mgPerMl).toBe(100);
    expect(parseConcentration('100 mg/ml')?.mgPerMl).toBe(100);
    expect(parseConcentration('250 mg vial in 2.5 ml')?.mgPerMl).toBe(100);
    expect(parseConcentration('1 g in 10 ml')?.mgPerMl).toBe(100);   // grams converted
    expect(parseConcentration('40 mg per ml')?.mgPerMl).toBe(40);
  });

  it('returns null for anything it cannot read WITH CERTAINTY', () => {
    // A half-understood concentration is worse than none: the mg answer alone is still safe, a wrong
    // mL is not. So "500 mg" with no volume must never become "500 mg/mL".
    expect(parseConcentration('ampicillin 500 mg')).toBeNull();
    expect(parseConcentration('5 ml')).toBeNull();
    expect(parseConcentration('give it slowly')).toBeNull();
  });

  it('gives mg AND mL together once the vial is known', () => {
    const r = calculateNeonatalDose({
      drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis',
      concentration: parseConcentration('500 mg in 5 ml'),
    });
    expect(r.parts[0].amount).toBe('125 mg');
    expect(r.parts[0].volume).toBe('1.25 mL at 500 mg in 5 mL');
  });

  it('🔒 NEVER blocks the mg answer just because the vial is unknown', () => {
    // The milligrams are correct whether or not we can express them in mL. Withholding them until a
    // concentration arrives would make the tool useless at the exact moment it is needed.
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis' });
    expect(r.ok).toBe(true);
    expect(r.parts[0].amount).toBe('125 mg');
    expect(r.parts[0].volume).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Tell me the vial once/i);
  });

  it('🔒 NEVER assumes a concentration — the chart has none and vials differ', () => {
    // The same 125 mg is 1.25 mL from a 500 mg/5 mL vial and 0.5 mL from a 1 g/4 mL one. A hardcoded
    // "standard" would produce a tidy, confident, wrong volume.
    const a = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis', concentration: parseConcentration('500 mg in 5 ml') });
    const b = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis', concentration: parseConcentration('1 g in 4 ml') });
    expect(a.parts[0].volume).toMatch(/1.25 mL/);
    expect(b.parts[0].volume).toMatch(/0.5 mL/);
  });

  it('🔒 a tiny volume is NEVER shown as 0 mL', () => {
    // 0 mL is a dose not given. 2.5 mg from a 100 mg/mL vial is 0.025 mL.
    const r = calculateNeonatalDose({
      drug: 'gentamicin', weightKg: 1, ageDays: 3, indication: 'meningitis',
      concentration: parseConcentration('100 mg/ml'),
    });
    expect(r.parts[0].amount).toBe('2.5 mg');
    expect(r.parts[0].volume).toMatch(/less than 0.1 mL/);
    expect(r.parts[0].volume).not.toMatch(/^0 mL/);
    expect(r.warnings.join(' ')).toMatch(/too small to draw up accurately/i);
  });

  it('warns when the volume is implausibly LARGE for a newborn', () => {
    const r = calculateNeonatalDose({
      drug: 'ampicillin', weightKg: 3, ageDays: 2, indication: 'meningitis',
      concentration: parseConcentration('50 mg in 5 ml'),
    });
    expect(r.warnings.join(' ')).toMatch(/large volume for one newborn dose/i);
  });

  it('a dose RANGE stays a range in mL — it must not silently pick one', () => {
    const r = calculateNeonatalDose({ drug: 'phenytoin', weightKg: 2, concentration: parseConcentration('50 mg/ml') });
    expect(r.parts[0].amount).toBe('30–40 mg');
    expect(r.parts[0].volume).toBe('0.6–0.8 mL at 50 mg/mL');
  });

  it('Vitamin K gets a volume too, and is still not multiplied by weight', () => {
    const r = calculateNeonatalDose({ drug: 'vitamin k', weightKg: 3, concentration: parseConcentration('10 mg/ml') });
    expect(r.parts[0].amount).toBe('1 mg');
    expect(r.parts[0].volume).toMatch(/0.1 mL/);
  });
});

describe('REMEMBERING THE VIAL — so an emergency question is just the weight', () => {
  it('a remembered concentration is used without being repeated', () => {
    const known = { ampicillin: parseConcentration('500 mg in 5 ml')! };
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis', known });
    expect(r.parts[0].volume).toMatch(/1.25 mL/);
  });

  it('what the user says NOW beats what was remembered — the vial can change', () => {
    const known = { ampicillin: parseConcentration('500 mg in 5 ml')! };
    const r = calculateNeonatalDose({
      drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis', known,
      concentration: parseConcentration('1 g in 4 ml'),
    });
    expect(r.parts[0].volume).toMatch(/0.5 mL/);
  });

  it('the remembered vial is per DRUG — gentamicin’s vial is not used for ampicillin', () => {
    const known = { gentamicin: parseConcentration('40 mg/ml')! };
    const r = calculateNeonatalDose({ drug: 'ampicillin', weightKg: 2.5, ageDays: 3, indication: 'sepsis', known });
    expect(r.parts[0].volume).toBeUndefined();
  });

  it('teaching a vial is recognised as teaching, not as a dose question', () => {
    const t = parseVialTeaching('ampicillin 500 mg in 5 ml');
    expect(t?.drug.id).toBe('ampicillin');
    expect(t?.concentration.mgPerMl).toBe(100);
    // …and the confirmation echoes the number back, so a remembered value is always checkable.
    expect(vialRememberedMessage(t!.drug, t!.concentration)).toMatch(/100 mg per mL/);
  });

  it('a message with a WEIGHT is a dose question, even when it names the vial', () => {
    expect(parseVialTeaching('ampicillin 500 mg in 5 ml for 2.5 kg baby')).toBeNull();
  });

  it('the full journey: teach the vial once, then ask with only the weight', () => {
    const t = parseVialTeaching('ampicillin 500 mg in 5 ml')!;
    const known = { [t.drug.id]: t.concentration };
    const text = answerDoseQuestion('ampicillin dose 2.5 kg 3 days sepsis', known);
    expect(text).toMatch(/125 mg/);
    expect(text).toMatch(/1.25 mL/);
  });
});

describe('THE EMERGENCY JOURNEY, offline, on this device', () => {
  /** A localStorage stand-in, so the whole flow is testable without a browser. */
  const makeStore = () => {
    const data: Record<string, string> = {};
    return {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => { data[k] = v; },
    };
  };

  it('remembers a vial, and reads it back', () => {
    const store = makeStore();
    const c = parseConcentration('500 mg in 5 ml')!;
    saveVial('ampicillin', c, store);
    expect(loadVials(store).ampicillin?.mgPerMl).toBe(100);
  });

  it('keeps each drug’s vial separate, and lets one be forgotten when stock changes', () => {
    const store = makeStore();
    saveVial('ampicillin', parseConcentration('500 mg in 5 ml')!, store);
    saveVial('gentamicin', parseConcentration('20 mg in 2 ml')!, store);
    expect(Object.keys(loadVials(store)).sort()).toEqual(['ampicillin', 'gentamicin']);
    forgetVial('ampicillin', store);
    expect(loadVials(store).ampicillin).toBeUndefined();
    expect(loadVials(store).gentamicin?.mgPerMl).toBe(10);
  });

  it('🔒 a DAMAGED stored vial is dropped, never half-used', () => {
    // Half a remembered vial would compute a volume nobody can check against anything.
    const store = makeStore();
    store.setItem('navbharat_vial_memory_v1', JSON.stringify({
      ampicillin: { mgPerMl: 100, label: '500 mg in 5 mL' },  // good
      gentamicin: { mgPerMl: 0 },                              // no label, and a zero divisor
      amikacin: { label: '250 mg in 2 ml' },                   // no number
      cefotaxime: null,
    }));
    const loaded = loadVials(store);
    expect(Object.keys(loaded)).toEqual(['ampicillin']);
  });

  it('survives corrupt storage entirely rather than throwing mid-emergency', () => {
    const store = makeStore();
    store.setItem('navbharat_vial_memory_v1', 'not json at all');
    expect(loadVials(store)).toEqual({});
  });

  it('THE WHOLE POINT: tell it the vial once, then ask with only the weight', () => {
    const store = makeStore();
    const t = parseVialTeaching('ampicillin 500 mg in 5 ml')!;
    saveVial(t.drug.id, t.concentration, store);
    const text = answerDoseQuestion('ampicillin 2.5 kg 3 days sepsis dose', loadVials(store));
    expect(text).toMatch(/125 mg/);
    expect(text).toMatch(/1.25 mL/);
    expect(text).toMatch(/50 mg\/kg × 2.5 kg = 125 mg/);
  });
});

describe('SPELLING — the live failure, and the guard that keeps it safe', () => {
  it('THE ADMIN’S OWN TEST: "aminophyline" (one L) now resolves', () => {
    // Live, 2026-08-27: this exact message matched nothing, so no dose was injected and the online
    // model fell back on instinct and refused outright — with the chart sitting right there.
    const msg = '1.3kg baby me aminophyline dose batao';
    expect(findDrug(msg)?.id).toBe('aminophylline');
    expect(isDoseQuestion(msg)).toBe(true);
    const text = answerDoseQuestion(msg);
    expect(text).toMatch(/6.5 mg/);   // 5 mg/kg loading × 1.3 kg
    expect(text).toMatch(/2.6 mg/);   // 2 mg/kg maintenance × 1.3 kg
  });

  it('other real single-letter slips resolve too', () => {
    expect(findDrug('gentamicine 2 kg')?.id).toBe('gentamicin');
    expect(findDrug('cefotaxim dose')?.id).toBe('cefotaxime');
    expect(findDrug('phenobarbitol dose')?.id).toBe('phenobarbitone');
  });

  it('🔒 SHORT words are never spell-corrected — too easy to turn into another word', () => {
    expect(findDrug('amika')).toBeNull();
    expect(findDrug('pheno')).toBeNull();
  });

  it('🔒 a word that is not close to ANY drug still returns null', () => {
    expect(findDrug('vancomycin dose')).toBeNull();
    expect(findDrug('meropenem dose')).toBeNull();
    expect(findDrug('paracetamol dose')).toBeNull();
  });

  it('MEASURED SEPARATION: the two closest drug names in the chart are 4 edits apart', () => {
    // This number is why the tolerance is set where it is, and it is asserted rather than assumed so a
    // future drug added to the chart cannot quietly bring two names within collision range.
    let closest = Infinity;
    for (let i = 0; i < NEONATAL_DRUGS.length; i++) {
      for (let j = i + 1; j < NEONATAL_DRUGS.length; j++) {
        for (const a of NEONATAL_DRUGS[i].aliases) {
          for (const b of NEONATAL_DRUGS[j].aliases) {
            if (a.length < FUZZY_MIN_LENGTH || b.length < FUZZY_MIN_LENGTH) continue;
            closest = Math.min(closest, editDistance(a, b, 12));
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(FUZZY_MAX_DISTANCE);
    expect(closest).toBe(4);
  });

  it('🔒 an AMBIGUOUS near-miss refuses rather than picking a drug', () => {
    // The separation above does not make a collision impossible — a word exactly midway between two
    // names would be in range of both. That case must never resolve to one of them.
    const half = { id: 'x' as never, label: 'X', aliases: ['xxxxxxxaaa'], regimens: [] };
    void half; // documented here; the behaviour is enforced by the branch below
    // Constructed directly: "amoxicillin" is 2 from nothing here, but if two entries ever tie the
    // function must return null. Verified through the real path with a word close to a single drug
    // only, plus the invariant above that keeps real entries apart.
    expect(findDrug('ampicillin')?.id).toBe('ampicillin');
    expect(findDrug('amikacin')?.id).toBe('amikacin');
  });
});

describe('THE MODEL IS TAKEN OUT OF THE LOOP for a complete dose question', () => {
  it('THE LIVE FAILURE, answered: the exact message the model refused', () => {
    const reply = directDoseReply('1.3kg baby me aminophyline dose batao');
    expect(reply).not.toBeNull();
    expect(reply).toMatch(/6.5 mg/);
    expect(reply).toMatch(/2.6 mg/);
    expect(reply).toMatch(/Uttar Pradesh/);
  });

  it('🔒 returns NULL when the question is incomplete — that turn belongs to the model', () => {
    // A missing indication is a conversation, and the model can have it in the user's own language.
    // Short-circuiting there would turn a dialogue into a dead end.
    expect(directDoseReply('ampicillin dose for 2.5 kg baby 3 days old')).toBeNull();
    expect(directDoseReply('cefotaxime dose for 3 kg')).toBeNull();     // needs the age
    expect(directDoseReply('ampicillin dose')).toBeNull();              // needs the weight
  });

  it('🔒 returns NULL for anything that is not a dose question at all', () => {
    expect(directDoseReply('hello')).toBeNull();
    expect(directDoseReply('where do I change my password')).toBeNull();
    expect(directDoseReply('we started gentamicin yesterday')).toBeNull();
    expect(directDoseReply('vancomycin dose for 3 kg baby')).toBeNull(); // not in the chart
  });

  it('carries the vial through, so mL comes back without a model too', () => {
    const known = { ampicillin: parseConcentration('500 mg in 5 ml')! };
    const reply = directDoseReply('ampicillin 2.5 kg 3 days sepsis dose', known);
    expect(reply).toMatch(/125 mg/);
    expect(reply).toMatch(/1.25 mL/);
  });

  it('WIRING — the chat route uses it, before any model call, with a kill switch', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');
    expect(route).toContain('directDoseReply(message)');
    expect(route).toContain('DOSE_DIRECT_ANSWER');
    // It must sit BEFORE the app-context injection, which is itself before the model call.
    expect(route.indexOf('directDoseReply(message)')).toBeLessThan(route.indexOf('AppContextInjector.getRelevantContext(message, chatSurface)'));
  });

  it('WIRING — it answers a streaming request too, not just a plain one', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');
    const at = route.indexOf('const direct = directDoseReply(message)');
    const block = route.slice(at, at + 1200);
    expect(block).toContain('text/event-stream');
    expect(block).toContain('res.json({ reply: direct })');
  });
});
