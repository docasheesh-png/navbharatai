import { describe, it, expect } from 'vitest';
import { computeClinicalTool } from '../src/server/lib/clinical/calculators';

describe('clinical calculators — deterministic & correct', () => {
  it('GCS sums eye+verbal+motor', () => {
    expect(computeClinicalTool('gcs', { eye: 4, verbal: 5, motor: 6 }).score).toBe(15);
    const severe = computeClinicalTool('gcs', { eye: 1, verbal: 1, motor: 4 });
    expect(severe.score).toBe(6);
    expect(severe.risk).toMatch(/Severe/);
  });

  it('GCS rejects out-of-range input', () => {
    expect(() => computeClinicalTool('gcs', { eye: 9, verbal: 5, motor: 6 })).toThrow();
  });

  it('CURB-65 — all criteria present = 5 (high)', () => {
    const r = computeClinicalTool('curb65', { confusion: true, ureaMmolL: 9, respiratoryRate: 32, systolicBP: 85, age: 80 });
    expect(r.score).toBe(5);
    expect(r.risk).toMatch(/High/);
  });

  it('CURB-65 — only age ≥65 = 1 (low)', () => {
    const r = computeClinicalTool('curb65', { confusion: false, ureaMmolL: 5, respiratoryRate: 18, systolicBP: 120, diastolicBP: 80, age: 70 });
    expect(r.score).toBe(1);
    expect(r.risk).toMatch(/Low/);
  });

  it('qSOFA — all three = 3 (high)', () => {
    const r = computeClinicalTool('qsofa', { respiratoryRate: 24, systolicBP: 95, alteredMentation: true });
    expect(r.score).toBe(3);
    expect(r.risk).toMatch(/High/);
  });

  it('CHA2DS2-VASc — 80yo female with HTN + DM = 5', () => {
    const r = computeClinicalTool('cha2ds2vasc', { age: 80, sex: 'female', hypertension: true, diabetes: true });
    // age≥75 (2) + HTN (1) + DM (1) + female (1) = 5
    expect(r.score).toBe(5);
    expect(r.risk).toMatch(/High/);
  });

  it('Wells PE — signs DVT + PE top dx + HR>100 = 7.5 (likely/high)', () => {
    const r = computeClinicalTool('wells_pe', { clinicalSignsDvt: true, peMostLikely: true, heartRate: 110 });
    expect(r.score).toBe(7.5);
    expect(r.risk).toMatch(/likely/i);
  });

  it('Wells DVT — alternative diagnosis subtracts 2', () => {
    const r = computeClinicalTool('wells_dvt', { activeCancer: true, entireLegSwollen: true, alternativeDiagnosisLikely: true });
    expect(r.score).toBe(0); // 1 + 1 - 2
    expect(r.risk).toMatch(/unlikely/i);
  });

  it('Pediatric dose — 15 mg/kg × 12 kg = 180 mg/dose', () => {
    const r = computeClinicalTool('pediatric_dose', { mgPerKg: 15, weightKg: 12, dosesPerDay: 4 });
    expect(r.score).toBe(180);
    expect(r.detail).toMatch(/720 mg\/day/);
  });

  it('Pediatric dose — caps at adult max', () => {
    const r = computeClinicalTool('pediatric_dose', { mgPerKg: 15, weightKg: 80, maxSingleMg: 1000 });
    expect(r.score).toBe(1000); // 15*80 = 1200, capped to 1000
    expect(r.detail).toMatch(/capped/);
  });

  it('unknown tool throws', () => {
    expect(() => computeClinicalTool('nonsense', {})).toThrow(/Unknown clinical tool/);
  });
});
