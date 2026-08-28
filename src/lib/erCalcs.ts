// ER QUICK CALCS — the unit arithmetic an emergency doctor re-derives under pressure (admin 2026-08-28:
// "emergency room me jo jo help kar sakta hai, woh bana do — doctor ki speed badhani hai").
//
// THE LINE THESE THREE SIT BEHIND, deliberately: every number in every formula here is SUPPLIED BY THE
// DOCTOR at use time — a dose rate they chose, a concentration off the vial they are holding, a drop
// factor printed on the giving set. The machine contributes UNIT CONVERSION ONLY. That is why these can
// ship without a source chart: there is no medical knowledge inside, only arithmetic — the same
// division the doctor would do on paper, minus the 3 a.m. slip.
//
// What deliberately does NOT live here: any default dose, any drug name with a number attached, any
// "usual" concentration. Those belong to the doctor's own formulary (customMedicines.ts) or the FBNC
// chart (neonatalDosing.ts), each with a named source. PURE throughout; every function total.

import { formatMg } from './neonatalDosing';

/** A rate the doctor may express a running infusion in. */
export type InfusionRateUnit = 'mcg/kg/min' | 'mcg/kg/hr' | 'mg/kg/hr' | 'mg/hr' | 'mcg/min';

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The rate in mg per hour, given the pieces the unit needs. Null when a needed piece is missing. */
export function rateToMgPerHour(rate: number, unit: InfusionRateUnit, weightKg: number | null): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const needsWeight = unit === 'mcg/kg/min' || unit === 'mcg/kg/hr' || unit === 'mg/kg/hr';
  if (needsWeight && (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0)) return null;
  const w = weightKg ?? 0;
  switch (unit) {
    case 'mcg/kg/min': return (rate * w * 60) / 1000;
    case 'mcg/kg/hr': return (rate * w) / 1000;
    case 'mg/kg/hr': return rate * w;
    case 'mg/hr': return rate;
    case 'mcg/min': return (rate * 60) / 1000;
  }
}

export interface PumpResult {
  mlPerHour: number;
  /** The whole chain written out so it can be checked against the vial and the order. */
  workings: string;
}

/**
 * FORWARD: the ordered dose rate → the pump's mL/hour. The number people mis-derive at speed. PURE.
 */
export function doseRateToPump(input: {
  rate: number | string; unit: InfusionRateUnit; weightKg?: number | string | null; mgPerMl: number | string;
}): PumpResult | { problem: string } {
  const rate = num(input.rate);
  const mgPerMl = num(input.mgPerMl);
  const weightKg = input.weightKg === undefined || input.weightKg === null || String(input.weightKg).trim() === '' ? null : num(input.weightKg);
  if (rate === null) return { problem: 'Enter the dose rate (a number above zero).' };
  if (mgPerMl === null) return { problem: 'Enter the concentration in mg per mL — it is on the syringe/vial label.' };
  const mgHr = rateToMgPerHour(rate, input.unit, weightKg);
  if (mgHr === null) return { problem: 'This rate is per kg — enter the patient’s weight.' };
  const mlHr = mgHr / mgPerMl;
  const wPart = input.unit.includes('/kg') ? ` × ${formatMg(weightKg as number)} kg` : '';
  return {
    mlPerHour: Math.round(mlHr * 100) / 100,
    workings: `${formatMg(rate)} ${input.unit}${wPart} = ${formatMg(mgHr)} mg/hour ÷ ${formatMg(mgPerMl)} mg/mL = ${formatMg(Math.round(mlHr * 100) / 100)} mL/hour`,
  };
}

/**
 * REVERSE: the pump's mL/hour → the dose actually running, in mcg/kg/min. The handover question —
 * "what is this pump giving?" — answered from the three numbers on the spot. PURE.
 */
export function pumpToDoseRate(input: {
  mlPerHour: number | string; mgPerMl: number | string; weightKg: number | string;
}): { mcgPerKgPerMin: number; workings: string } | { problem: string } {
  const mlHr = num(input.mlPerHour);
  const mgPerMl = num(input.mgPerMl);
  const weightKg = num(input.weightKg);
  if (mlHr === null) return { problem: 'Enter the pump’s mL per hour.' };
  if (mgPerMl === null) return { problem: 'Enter the concentration in mg per mL.' };
  if (weightKg === null) return { problem: 'Enter the patient’s weight in kg.' };
  const mcgKgMin = (mlHr * mgPerMl * 1000) / 60 / weightKg;
  const rounded = Math.round(mcgKgMin * 1000) / 1000;
  return {
    mcgPerKgPerMin: rounded,
    workings: `${formatMg(mlHr)} mL/h × ${formatMg(mgPerMl)} mg/mL = ${formatMg(mlHr * mgPerMl)} mg/h = ${formatMg(mlHr * mgPerMl * 1000 / 60)} mcg/min ÷ ${formatMg(weightKg)} kg = ${formatMg(rounded)} mcg/kg/min`,
  };
}

/**
 * DRIP RATE — no pump, a giving set and a watch (the everyday reality of many Indian EDs).
 * Volume over time + the set's printed drop factor → drops/min, plus the COUNTABLE form: seconds per
 * drop, because nobody counts 37 drops in a minute under pressure — they time one drop. PURE.
 */
export function dripRate(input: {
  volumeMl: number | string; overMinutes: number | string; dropFactor: number | string;
}): { dropsPerMin: number; secondsPerDrop: number; workings: string } | { problem: string } {
  const vol = num(input.volumeMl);
  const mins = num(input.overMinutes);
  const factor = num(input.dropFactor);
  if (vol === null) return { problem: 'Enter the volume in mL.' };
  if (mins === null) return { problem: 'Enter the time in minutes.' };
  if (factor === null) return { problem: 'Enter the drop factor printed on the giving set (10, 15, 20, or 60 for a microdrip).' };
  const dpm = (vol * factor) / mins;
  const spd = 60 / dpm;
  return {
    dropsPerMin: Math.round(dpm),
    secondsPerDrop: Math.round(spd * 10) / 10,
    workings: `${formatMg(vol)} mL × ${formatMg(factor)} drops/mL ÷ ${formatMg(mins)} min = ${Math.round(dpm)} drops/min (≈ 1 drop every ${Math.round(spd * 10) / 10} s)`,
  };
}

/**
 * DILUTION PREP — "I need this final concentration in this syringe; how much stock, how much diluent?"
 * All three numbers are the doctor's; refuses honestly when the stock is WEAKER than the target
 * (no volume of diluent can concentrate a drug). PURE.
 */
export function dilutionPrep(input: {
  stockMgPerMl: number | string; targetMgPerMl: number | string; finalVolumeMl: number | string;
}): { stockMl: number; diluentMl: number; workings: string } | { problem: string } {
  const stock = num(input.stockMgPerMl);
  const target = num(input.targetMgPerMl);
  const vol = num(input.finalVolumeMl);
  if (stock === null) return { problem: 'Enter the stock strength in mg per mL (on the vial).' };
  if (target === null) return { problem: 'Enter the concentration you want, in mg per mL.' };
  if (vol === null) return { problem: 'Enter the final volume in mL.' };
  if (target > stock) return { problem: 'The target is STRONGER than the stock — no amount of diluent can concentrate a drug. Check both numbers.' };
  const stockMl = (target * vol) / stock;
  const diluentMl = vol - stockMl;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    stockMl: r(stockMl),
    diluentMl: r(diluentMl),
    workings: `${formatMg(target)} mg/mL × ${formatMg(vol)} mL = ${formatMg(target * vol)} mg needed ÷ ${formatMg(stock)} mg/mL = ${r(stockMl)} mL stock + ${r(diluentMl)} mL diluent`,
  };
}
