import { describe, it, expect } from 'vitest';
import {
  calculateNeonatalDose, answerDoseQuestion, parseWeightKg, parseAgeDays, findDrug, findIndication,
  isDoseQuestion, formatMg, NEONATAL_DRUGS, MIN_WEIGHT_KG, MAX_WEIGHT_KG,
} from './neonatalDosing';
import { answerOffline } from './offlineAssistant';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';

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
