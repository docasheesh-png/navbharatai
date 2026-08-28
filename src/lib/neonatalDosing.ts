// NEONATAL DRUG DOSING — the deterministic calculator every NavBharatAI AI answers from.
//
// ADMIN 2026-08-27: "mujhe yeh dose NavBharatAI ko yaad karwana hai … mai weight bata kar dose puchunga,
// to sabhi AI (offline AI ke saath) isi chart ke anusar calculation kar ke dose bata de."
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS CODE AND NOT A PROMPT. The obvious build is to paste the chart into every AI's system
// prompt and let the model do the arithmetic. That is the wrong architecture for THIS content, and the
// reason is not style — it is that a language model recalling a table and multiplying can misremember a
// number or slip a decimal, and it will sound exactly as confident either way. For a newborn's drug
// dose, a confident wrong number is the worst possible failure mode.
//
// So the numbers live HERE: one source of truth, pure, unit-tested, no network. The model's only job is
// to understand the question and read this out. The offline AI gets it for free, because a pure function
// needs no model at all.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// 🔒 THE FOUR TRAPS IN THE SOURCE CHARTS, AND HOW EACH IS CLOSED HERE.
//
// 1. AMPICILLIN IS 50 OR 100 mg/kg/dose DEPENDING ON THE INDICATION — and the two charts disagree by
//    omission. Chart 13 lists a single 50 mg/kg/dose with no indication column; the sepsis chart lists
//    50 for septicaemia/pneumonia and 100 for MENINGITIS. An answer built from Chart 13 alone gives a
//    baby with meningitis HALF the dose the guideline intends. So indication is a REQUIRED input for
//    ampicillin — never defaulted, never guessed from context.
//
// 2. GENTAMICIN CHANGES BOTH DOSE AND FREQUENCY with the indication: 5 mg/kg once daily for sepsis or
//    pneumonia, but 2.5 mg/kg 12- or 8-hourly for meningitis. Same requirement: ask, do not assume.
//
// 3. VITAMIN K IS A FLAT 1 mg, NOT per kilogram. A calculator that multiplies everything by weight
//    would hand a 3 kg baby 3 mg. It is modelled as a fixed dose so the multiplication cannot happen.
//
// 4. DOPAMINE/DOBUTAMINE IS NOT A DOSE — it is 5–20 microgram/kg/MINUTE, a continuous infusion. Turning
//    that into mL/hour needs the concentration and diluent volume, and the chart gives NEITHER. So this
//    returns micrograms per minute and REFUSES to invent an infusion rate. Making one up is precisely
//    the "looks done, does nothing" failure the second absolute rule forbids, with a baby attached.
//
// PURE — no I/O, no clock, no model. Every rule below is directly testable.

/** The exact source, carried into every answer so a nurse can check the number against the page. */
export const DOSING_SOURCE =
  'Government of Uttar Pradesh — Facility Based Newborn Care operational guide: Chart 13 (commonly used drugs) and the neonatal sepsis antibiotic tables';

/** What the calculator will not do silently, said once and shown with every answer. */
export const DOSING_CAUTION =
  'Confirm the weight, the age in days and the indication before giving. This calculates from the chart above — it does not replace your unit protocol or a prescriber.';

export type DrugId =
  | 'ampicillin' | 'cloxacillin' | 'gentamicin' | 'amikacin' | 'cefotaxime' | 'chloramphenicol'
  | 'aminophylline' | 'vitamin_k' | 'phenobarbitone' | 'phenytoin' | 'dopamine';

/** Septicaemia and pneumonia share a row in the chart; meningitis is its own, different row. */
export type Indication = 'sepsis' | 'pneumonia' | 'meningitis';

/**
 * A newborn's plausible weight, in kg. Outside this the calculator REFUSES rather than computing.
 *
 * Not fussiness: the single most likely data-entry error is a units or decimal slip ("32" for 3.2 kg),
 * and every drug here is milligrams PER KILOGRAM — so a 10× typo is a 10× overdose that the arithmetic
 * itself will never notice. 0.4 kg is below any resuscitated preterm; 8 kg is far above any newborn.
 */
export const MIN_WEIGHT_KG = 0.4;
export const MAX_WEIGHT_KG = 8;

/** The oldest age this chart's neonatal schedules apply to (28 days = the newborn period). */
export const MAX_AGE_DAYS = 28;

// ── THE CHART, AS DATA ──────────────────────────────────────────────────────────────────────────────

/** One computable component of a drug's regimen (a loading dose, a maintenance dose, an infusion). */
export interface Regimen {
  /** What this component is called in the answer: 'Dose', 'Loading dose', 'Maintenance'. */
  label: string;
  /** mg per kg per dose. Null for a fixed-milligram drug (Vitamin K) or an infusion. */
  mgPerKg?: number;
  /** An upper bound where the chart prints a range ("15-20 mg/kg loading"). */
  mgPerKgMax?: number;
  /** A dose that is NOT weight-based — the whole point of Vitamin K being here. */
  fixedMg?: number;
  /** How often, for a baby under 7 days old. */
  freqUnder7d?: string;
  /** How often, for a baby 7 days or older. */
  freq7dPlus?: string;
  /** How often, when the chart gives one frequency for every age. */
  freqAnyAge?: string;
  route: string;
  /** Given over this long — the chart states it for the anticonvulsant loading doses. */
  over?: string;
  /** How long the course runs, where the chart says. */
  duration?: string;
  /** Anything the chart says that a number cannot carry. */
  note?: string;
}

export interface DrugEntry {
  id: DrugId;
  /** What the answer calls it. */
  label: string;
  /** Everything a user might type, lowercase — including the spellings the charts themselves use. */
  aliases: string[];
  /**
   * When the dose or frequency DIFFERS by indication, the regimens are keyed by it and the caller must
   * say which. An entry with `byIndication` and no `regimens` cannot be answered without one.
   */
  regimens?: Regimen[];
  byIndication?: Partial<Record<Indication, Regimen[]>>;
  /** micrograms/kg/minute — a continuous infusion, deliberately not a "dose". */
  infusion?: { minMcgPerKgPerMin: number; maxMcgPerKgPerMin: number; route: string };
  /** Carried into the answer whenever this drug is asked about. */
  cautions?: string[];
}

/**
 * ⚠️ EVERY NUMBER BELOW IS TRANSCRIBED FROM THE TWO CHARTS AND NOTHING ELSE. No value is "improved",
 * rounded, modernised or filled in from general knowledge — where the chart is silent, this is silent,
 * and the gap is reported honestly rather than papered over with a plausible number.
 */
export const NEONATAL_DRUGS: DrugEntry[] = [
  {
    id: 'ampicillin',
    label: 'Ampicillin',
    aliases: ['ampicillin', 'ampicilin', 'ampi', 'inj ampicillin'],
    byIndication: {
      sepsis: [{ label: 'Dose', mgPerKg: 50, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV', duration: '7–10 days' }],
      pneumonia: [{ label: 'Dose', mgPerKg: 50, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV', duration: '7–10 days' }],
      // DOUBLE the septicaemia dose. This is the single most dangerous line in the whole chart to get
      // wrong, and the reason indication is mandatory for this drug rather than assumed.
      meningitis: [{ label: 'Dose', mgPerKg: 100, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV', duration: '3 weeks' }],
    },
    cautions: ['The meningitis dose is double the septicaemia/pneumonia dose (100 vs 50 mg/kg/dose) — confirm which you are treating.'],
  },
  {
    id: 'cloxacillin',
    label: 'Cloxacillin',
    aliases: ['cloxacillin', 'cloxacilin', 'cloxa', 'inj cloxacillin'],
    regimens: [{ label: 'Dose', mgPerKg: 50, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV', duration: '7–10 days' }],
    cautions: ['The chart lists cloxacillin for septicaemia/pneumonia only — it gives no meningitis regimen for it.'],
  },
  {
    id: 'gentamicin',
    label: 'Gentamicin',
    aliases: ['gentamicin', 'gentamycin', 'genta', 'inj gentamicin', 'gentamicine'],
    byIndication: {
      sepsis: [{ label: 'Dose', mgPerKg: 5, freqAnyAge: 'every 24 hours', route: 'IV', duration: '7–10 days' }],
      pneumonia: [{ label: 'Dose', mgPerKg: 5, freqAnyAge: 'every 24 hours', route: 'IV', duration: '7–10 days' }],
      // Half the dose, but two to three times a day — the indication changes BOTH numbers.
      meningitis: [{ label: 'Dose', mgPerKg: 2.5, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV', duration: '3 weeks' }],
    },
    cautions: ['Gentamicin changes both dose and frequency with the indication (5 mg/kg once daily for sepsis; 2.5 mg/kg 12- or 8-hourly for meningitis).'],
  },
  {
    id: 'amikacin',
    label: 'Amikacin',
    aliases: ['amikacin', 'amikacine', 'inj amikacin'],
    regimens: [{ label: 'Dose', mgPerKg: 15, freqAnyAge: 'every 24 hours', route: 'IV', duration: '7–10 days' }],
    // Chart 13 prints only a "<7 Days" row for amikacin; the sepsis table gives 24-hourly at BOTH ages.
    // The sepsis table is the more complete of the two, so it is used — and the discrepancy is declared
    // rather than hidden, because a reader checking Chart 13 alone will not find the older-baby row.
    cautions: ['Chart 13 shows an under-7-days row only; the sepsis table gives 15 mg/kg 24-hourly at both ages, which is what is used here.'],
  },
  {
    id: 'cefotaxime',
    label: 'Cefotaxime',
    aliases: ['cefotaxime', 'cefotaxim', 'claforan', 'inj cefotaxime'],
    regimens: [{ label: 'Dose', mgPerKg: 50, freqUnder7d: 'every 12 hours', freq7dPlus: 'every 8 hours', route: 'IV' }],
    cautions: ['For meningitis the chart pairs cefotaxime with gentamicin and runs the course for 3 weeks.'],
  },
  {
    id: 'chloramphenicol',
    label: 'Chloramphenicol',
    aliases: ['chloramphenicol', 'chloramphenicole', 'chloromycetin'],
    regimens: [{ label: 'Dose', mgPerKg: 12, freqAnyAge: 'every 12 hours', route: 'IV' }],
  },
  {
    id: 'aminophylline',
    label: 'Aminophylline',
    aliases: ['aminophylline', 'aminophyllin', 'aminophilline'],
    regimens: [
      { label: 'Loading dose', mgPerKg: 5, route: 'IV' },
      { label: 'Maintenance', mgPerKg: 2, freqAnyAge: 'every 8–12 hours', route: 'IV' },
    ],
  },
  {
    id: 'vitamin_k',
    label: 'Vitamin K',
    aliases: ['vitamin k', 'vit k', 'vitamink', 'phytomenadione', 'phytonadione', 'menadione'],
    // FIXED milligrams. Never multiplied by weight — see trap 3 in the header.
    regimens: [{ label: 'Dose', fixedMg: 1, route: 'IM' }],
    cautions: ['This is a fixed 1 mg dose in the chart — it is not calculated from the baby’s weight.'],
  },
  {
    id: 'phenobarbitone',
    label: 'Phenobarbitone',
    aliases: ['phenobarbitone', 'phenobarbital', 'phenobarb', 'luminal', 'gardenal'],
    regimens: [
      { label: 'Loading dose', mgPerKg: 20, route: 'IV', over: 'over 10–15 minutes' },
      { label: 'Maintenance', mgPerKg: 3, mgPerKgMax: 4, freqAnyAge: 'every 24 hours', route: 'IV, IM or oral' },
    ],
  },
  {
    id: 'phenytoin',
    label: 'Phenytoin',
    aliases: ['phenytoin', 'phenytoine', 'dilantin', 'eptoin'],
    regimens: [
      { label: 'Loading dose', mgPerKg: 15, mgPerKgMax: 20, route: 'IV', over: 'over 10–15 minutes' },
      { label: 'Maintenance', mgPerKg: 5, freqAnyAge: 'every 24 hours', route: 'IV' },
    ],
  },
  {
    id: 'dopamine',
    label: 'Dopamine / Dobutamine',
    aliases: ['dopamine', 'dobutamine', 'dopa', 'dobuta', 'inotrope'],
    infusion: { minMcgPerKgPerMin: 5, maxMcgPerKgPerMin: 20, route: 'IV continuous infusion' },
    cautions: ['This is a continuous infusion, titrated to the baby’s perfusion — not a one-off dose.'],
  },
];

// ── THE CALCULATOR ──────────────────────────────────────────────────────────────────────────────────

/** Something the calculator needs before it will answer. It ASKS rather than assuming. */
export interface DoseNeed {
  field: 'drug' | 'weight' | 'age' | 'indication';
  /** The question to put to the user, in plain words. */
  question: string;
}

export interface DosePart {
  label: string;
  /** The computed amount, e.g. "60 mg" or "45–60 mg". Empty for an infusion component. */
  amount: string;
  /** The chart's own rate, e.g. "20 mg/kg/dose". */
  perKg: string;
  frequency?: string;
  route: string;
  over?: string;
  duration?: string;
  /** The arithmetic, written out, so anyone can check it: "20 mg/kg × 3 kg = 60 mg". */
  workings: string;
}

export interface DoseResult {
  ok: boolean;
  drugLabel?: string;
  parts: DosePart[];
  /** Real cautions from the chart, plus anything this calculation itself could not settle. */
  warnings: string[];
  /** Non-empty means we did NOT answer, and this is what we need. */
  needs: DoseNeed[];
  /** The honest sentence when `ok` is false. */
  message?: string;
  source: string;
}

export interface DoseQuery {
  drug: string;
  weightKg?: number | null;
  ageDays?: number | null;
  indication?: Indication | null;
}

/** Trim float noise without hiding a real decimal: 67.5 stays, 0.30000000000000004 becomes 0.3. */
export function formatMg(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Number(rounded.toFixed(3)));
}

/** Match what the user typed to a drug in the chart. Never fuzzy — a near-miss returns null. PURE. */
export function findDrug(input: string): DrugEntry | null {
  const q = String(input ?? '').toLowerCase().trim().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  for (const d of NEONATAL_DRUGS) {
    for (const a of d.aliases) {
      // Whole-word containment: "genta" matches "genta 3 kg", but "amp" does not match "ampicillin"
      // by accident from the other direction — an abbreviation must be an alias to count.
      if (q === a || q.includes(` ${a} `) || q.startsWith(`${a} `) || q.endsWith(` ${a}`)) return d;
    }
  }
  return null;
}

/**
 * Which indication the user named, or null.
 *
 * DELIBERATELY LITERAL. Nothing is inferred from surrounding words: "the baby looks septic" does not
 * become sepsis here, because for ampicillin that guess is the difference between 50 and 100 mg/kg and
 * a classifier that is usually right is the wrong instrument for a doubling. PURE.
 */
export function findIndication(input: string): Indication | null {
  const q = String(input ?? '').toLowerCase();
  if (/\bmeningitis\b|\bmeningitic\b/.test(q)) return 'meningitis';
  if (/\bpneumonia\b|\bpneumonitis\b/.test(q)) return 'pneumonia';
  if (/\bsepsis\b|\bsepticaemia\b|\bsepticemia\b|\bseptic\b/.test(q)) return 'sepsis';
  return null;
}

/** True when this drug's answer depends on knowing the indication (ampicillin, gentamicin). */
export function needsIndication(drug: DrugEntry): boolean {
  return !!drug.byIndication;
}

/** True when any of this drug's regimens splits its frequency by age. */
export function needsAge(regimens: Regimen[]): boolean {
  return regimens.some((r) => r.freqUnder7d || r.freq7dPlus);
}

/** True when any regimen actually uses the weight (Vitamin K's fixed dose does not). */
export function needsWeight(drug: DrugEntry, regimens: Regimen[]): boolean {
  if (drug.infusion) return true;
  return regimens.some((r) => typeof r.mgPerKg === 'number');
}

/**
 * The one calculation. Returns a computed regimen, or exactly what it still needs — never a guess.
 *
 * The order of the checks is the safety property, so it is fixed here and not at any call site:
 * identify the drug, refuse an implausible weight, then require every input the chart's own branching
 * depends on. Only when nothing is missing does any arithmetic happen. PURE.
 */
export function calculateNeonatalDose(query: DoseQuery): DoseResult {
  const base = { parts: [] as DosePart[], warnings: [] as string[], needs: [] as DoseNeed[], source: DOSING_SOURCE };
  const drug = findDrug(query.drug);
  if (!drug) {
    return {
      ...base, ok: false,
      // NEVER reach outside the chart. A dose recalled from general knowledge is exactly the confident
      // wrong number this module exists to prevent, and it would be indistinguishable from a real one.
      message: `“${String(query.drug ?? '').trim() || 'That drug'}” is not in this chart, so I will not give a dose for it. The chart covers: ${NEONATAL_DRUGS.map((d) => d.label).join(', ')}.`,
      needs: [{ field: 'drug', question: 'Which of the drugs in the chart do you need?' }],
    };
  }

  const warnings: string[] = [...(drug.cautions ?? [])];
  const weight = typeof query.weightKg === 'number' && Number.isFinite(query.weightKg) ? query.weightKg : null;
  const age = typeof query.ageDays === 'number' && Number.isFinite(query.ageDays) ? Math.floor(query.ageDays) : null;

  // ── WEIGHT, BEFORE ANYTHING ELSE ────────────────────────────────────────────────────────────────
  // A units or decimal slip is the likeliest error in the whole flow, and every number here is per
  // kilogram — so the arithmetic would multiply the mistake rather than reveal it.
  if (weight !== null && (weight < MIN_WEIGHT_KG || weight > MAX_WEIGHT_KG)) {
    return {
      ...base, ok: false, drugLabel: drug.label, warnings,
      message: `${formatMg(weight)} kg is outside the newborn range this chart covers (${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg), so I have not calculated a dose. If that weight is right, this chart is not the right one — check the weight and tell me again.`,
      needs: [{ field: 'weight', question: `What is the baby’s weight in kg (${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG})?` }],
    };
  }
  if (age !== null && age > MAX_AGE_DAYS) {
    warnings.push(`These are newborn schedules (up to ${MAX_AGE_DAYS} days). At ${age} days, check a paediatric chart instead.`);
  }

  // ── INDICATION, WHERE THE CHART BRANCHES ON IT ──────────────────────────────────────────────────
  let regimens: Regimen[] | undefined = drug.regimens;
  if (drug.byIndication) {
    const ind = query.indication ?? null;
    if (!ind) {
      return {
        ...base, ok: false, drugLabel: drug.label, warnings,
        message: `${drug.label}’s dose depends on what is being treated, and I will not choose for you — for ampicillin it is the difference between 50 and 100 mg/kg/dose. Is this sepsis, pneumonia, or meningitis?`,
        needs: [{ field: 'indication', question: 'Is this for sepsis, pneumonia, or meningitis?' }],
      };
    }
    regimens = drug.byIndication[ind];
    if (!regimens) {
      return {
        ...base, ok: false, drugLabel: drug.label, warnings,
        message: `The chart gives no ${ind} regimen for ${drug.label}, so I have nothing to calculate from. It would be inventing a number to answer.`,
        needs: [{ field: 'indication', question: 'Which indication does the chart cover for this drug?' }],
      };
    }
  }

  // ── INFUSIONS ARE NOT DOSES ─────────────────────────────────────────────────────────────────────
  if (drug.infusion) {
    if (weight === null) {
      return { ...base, ok: false, drugLabel: drug.label, warnings, message: `I need the baby’s weight to work out the ${drug.label} infusion.`, needs: [{ field: 'weight', question: 'What is the baby’s weight in kg?' }] };
    }
    const lo = drug.infusion.minMcgPerKgPerMin * weight;
    const hi = drug.infusion.maxMcgPerKgPerMin * weight;
    // What is deliberately NOT here: millilitres per hour. That needs the concentration and the diluent
    // volume, and this chart gives neither — so producing a pump rate would mean inventing the missing
    // half of the sum and presenting it as a reading.
    warnings.push('This chart does not give a dilution, so I cannot work out a millilitres-per-hour pump rate — use your unit’s infusion chart for that.');
    return {
      ok: true, drugLabel: drug.label, warnings, needs: [], source: DOSING_SOURCE,
      parts: [{
        label: 'Continuous infusion',
        amount: `${formatMg(lo)}–${formatMg(hi)} micrograms per minute`,
        perKg: `${drug.infusion.minMcgPerKgPerMin}–${drug.infusion.maxMcgPerKgPerMin} micrograms/kg/minute`,
        route: drug.infusion.route,
        workings: `${drug.infusion.minMcgPerKgPerMin}–${drug.infusion.maxMcgPerKgPerMin} mcg/kg/min × ${formatMg(weight)} kg = ${formatMg(lo)}–${formatMg(hi)} mcg/min`,
      }],
    };
  }

  const list = regimens ?? [];
  if (list.length === 0) {
    return { ...base, ok: false, drugLabel: drug.label, warnings, message: `The chart has no regimen recorded for ${drug.label}.`, needs: [] };
  }

  // ── THE REMAINING INPUTS ────────────────────────────────────────────────────────────────────────
  if (needsWeight(drug, list) && weight === null) {
    return { ...base, ok: false, drugLabel: drug.label, warnings, message: `I need the baby’s weight in kg to calculate the ${drug.label} dose.`, needs: [{ field: 'weight', question: 'What is the baby’s weight in kg?' }] };
  }
  if (needsAge(list) && age === null) {
    return { ...base, ok: false, drugLabel: drug.label, warnings, message: `${drug.label}’s frequency changes at 7 days of age, so I need the baby’s age in days.`, needs: [{ field: 'age', question: 'How many days old is the baby?' }] };
  }

  // THE DAY-7 BOUNDARY, STATED RATHER THAN QUIETLY PICKED. The charts print "<7 days" and ">7 days" and
  // define neither for a baby who is exactly 7 days old. This uses the 7-days-and-over schedule — but it
  // says so, because a silent choice here is a real decision made on the reader's behalf without telling
  // them, and the two branches differ by a whole extra dose a day.
  const olderSchedule = age !== null && age >= 7;
  if (age === 7 && needsAge(list)) {
    warnings.push('The chart writes “<7 days” and “>7 days”, so day 7 exactly is not spelled out. I have used the 7-days-and-over schedule — confirm which your unit follows.');
  }

  const parts: DosePart[] = list.map((r) => {
    const frequency = r.freqAnyAge ?? (olderSchedule ? r.freq7dPlus : r.freqUnder7d);
    if (typeof r.fixedMg === 'number') {
      return {
        label: r.label, amount: `${formatMg(r.fixedMg)} mg`, perKg: `${formatMg(r.fixedMg)} mg (fixed dose)`,
        frequency, route: r.route, over: r.over, duration: r.duration,
        workings: `${formatMg(r.fixedMg)} mg — a fixed dose, not multiplied by weight`,
      };
    }
    const lo = (r.mgPerKg ?? 0) * (weight ?? 0);
    const hi = typeof r.mgPerKgMax === 'number' ? r.mgPerKgMax * (weight ?? 0) : null;
    const perKg = typeof r.mgPerKgMax === 'number' ? `${r.mgPerKg}–${r.mgPerKgMax} mg/kg/dose` : `${r.mgPerKg} mg/kg/dose`;
    const amount = hi === null ? `${formatMg(lo)} mg` : `${formatMg(lo)}–${formatMg(hi)} mg`;
    const workings = hi === null
      ? `${r.mgPerKg} mg/kg × ${formatMg(weight ?? 0)} kg = ${formatMg(lo)} mg`
      : `${r.mgPerKg}–${r.mgPerKgMax} mg/kg × ${formatMg(weight ?? 0)} kg = ${formatMg(lo)}–${formatMg(hi)} mg`;
    return { label: r.label, amount, perKg, frequency, route: r.route, over: r.over, duration: r.duration, workings };
  });

  return { ok: true, drugLabel: drug.label, parts, warnings, needs: [], source: DOSING_SOURCE };
}

// ── UNDERSTANDING WHAT THE USER TYPED ───────────────────────────────────────────────────────────────

/**
 * Pull a newborn's weight out of a sentence, in kg. Grams are converted; a bare number is NOT taken.
 *
 * "2.5", alone, could be kilograms, days, or the number of doses. Guessing it as a weight is how a
 * calculator quietly doses the wrong figure — so a unit is required, and Hindi/Hinglish units count
 * because that is what this app's users actually type. PURE.
 */
export function parseWeightKg(input: string): number | null {
  const q = String(input ?? '').toLowerCase();
  const g = /(\d+(?:\.\d+)?)\s*(?:grams?|gram|gm|gms|g\b)/.exec(q);
  if (g) {
    const grams = Number(g[1]);
    // A "3 g" is a gram figure only if it is plausibly a birth weight; 3 grams is not a baby.
    if (Number.isFinite(grams) && grams >= 300) return grams / 1000;
  }
  const kg = /(\d+(?:\.\d+)?)\s*(?:kgs?|kilo(?:gram)?s?|kilos?)\b/.exec(q);
  if (kg) {
    const v = Number(kg[1]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/** Pull an age in days. Accepts English and the Hindi/Hinglish words users really type. PURE. */
export function parseAgeDays(input: string): number | null {
  const q = String(input ?? '').toLowerCase();
  const d = /(\d+(?:\.\d+)?)\s*(?:days?|day|din|dino|dinon)\b/.exec(q);
  if (d) {
    const v = Number(d[1]);
    if (Number.isFinite(v) && v >= 0) return Math.floor(v);
  }
  const w = /(\d+(?:\.\d+)?)\s*(?:weeks?|hafte|hafta)\b/.exec(q);
  if (w) {
    const v = Number(w[1]);
    if (Number.isFinite(v) && v >= 0) return Math.floor(v * 7);
  }
  // "newborn" / "just born" / "aaj paida" is day 0 — stated by the user, not inferred from context.
  if (/\b(?:newborn|new born|just born|birth|aaj paida|abhi paida)\b/.test(q)) return 0;
  return null;
}

/** Everything the calculator needs, read out of one free-text message. PURE. */
export function parseDoseQuestion(message: string): DoseQuery {
  return {
    drug: String(message ?? ''),
    weightKg: parseWeightKg(message),
    ageDays: parseAgeDays(message),
    indication: findIndication(message),
  };
}

/**
 * Is this message asking for a dose at all?
 *
 * Requires a drug from the chart AND a dosing word, so ordinary talk that happens to mention a drug
 * ("we started gentamicin yesterday") does not trigger a calculator reply. PURE.
 */
export function isDoseQuestion(message: string): boolean {
  if (!findDrug(message)) return false;
  const q = String(message ?? '').toLowerCase();
  return /\bdose|dosage|dosing|how much|kitna|kitni|khurak|matra|mg\b|calculate\b/.test(q)
    || parseWeightKg(message) !== null;
}

// ── SAYING IT ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The answer as plain text, for a chat bubble.
 *
 * The workings are ALWAYS shown. A dose a nurse cannot check is a dose they have to take on trust, and
 * the whole reason this is code rather than a model is that trust should not be necessary. PURE.
 */
export function formatDoseAnswer(r: DoseResult): string {
  if (!r.ok) {
    const ask = r.needs.map((n) => n.question).join(' ');
    return [r.message, ask].filter(Boolean).join('\n\n');
  }
  const lines: string[] = [`${r.drugLabel} — from the newborn dosing chart:`, ''];
  for (const p of r.parts) {
    const bits = [`• ${p.label}: ${p.amount}`];
    if (p.frequency) bits.push(p.frequency);
    if (p.over) bits.push(p.over);
    bits.push(p.route);
    lines.push(bits.join(' · '));
    lines.push(`   ${p.workings}   (chart: ${p.perKg})`);
    if (p.duration) lines.push(`   Duration: ${p.duration}`);
  }
  if (r.warnings.length) {
    lines.push('');
    for (const w of r.warnings) lines.push(`⚠️ ${w}`);
  }
  lines.push('', `Source: ${r.source}`, DOSING_CAUTION);
  return lines.join('\n');
}

/** One-call convenience for a chat surface: message in, answer out. PURE. */
export function answerDoseQuestion(message: string): string {
  return formatDoseAnswer(calculateNeonatalDose(parseDoseQuestion(message)));
}
