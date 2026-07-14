import { describe, it, expect } from 'vitest';
import {
  curb65, crb65, qsofa, gcs, wellsDvt, wellsPe, cha2ds2vasc,
  egfrCockcroftGault, anionGap, killip, centorMcIsaac, pediatricMaintenanceFluid, pediatricDose,
  computeClinicalTool, AVAILABLE_CLINICAL_TOOLS,
} from './calculators';

// These are clinical-safety calculators — a wrong number is a dosing/triage error. Each test encodes a
// known reference case so the formula can never silently drift.

describe('CURB-65 / CRB-65 — pneumonia severity', () => {
  it('CURB-65 scores all five criteria', () => {
    expect(curb65({ confusion: true, ureaMmolL: 8, respiratoryRate: 32, systolicBP: 85, age: 70 }).score).toBe(5);
  });
  it('CURB-65 is 0 for a well young adult', () => {
    expect(curb65({ age: 40, systolicBP: 120, diastolicBP: 80, respiratoryRate: 18, ureaMmolL: 5 }).score).toBe(0);
  });
  it('CRB-65 drops the urea criterion (max 4, no blood test)', () => {
    expect(crb65({ confusion: true, respiratoryRate: 32, systolicBP: 85, age: 70 }).score).toBe(4);
    expect(crb65({ age: 40, systolicBP: 120, respiratoryRate: 18 }).score).toBe(0);
  });
});

describe('qSOFA / GCS', () => {
  it('qSOFA scores its three bedside criteria', () => {
    expect(qsofa({ respiratoryRate: 24, systolicBP: 95, alteredMentation: true }).score).toBe(3);
    expect(qsofa({ respiratoryRate: 18, systolicBP: 120 }).score).toBe(0);
  });
  it('GCS sums E+V+M and rejects out-of-range input', () => {
    expect(gcs({ eye: 4, verbal: 5, motor: 6 }).score).toBe(15);
    expect(gcs({ eye: 1, verbal: 1, motor: 1 }).score).toBe(3);
    expect(() => gcs({ eye: 5, verbal: 5, motor: 6 })).toThrow();
  });
});

describe('Wells (DVT/PE) / CHA2DS2-VASc', () => {
  it('Wells DVT: alternative diagnosis subtracts 2', () => {
    expect(wellsDvt({ activeCancer: true, previousDvt: true }).score).toBe(2);
    expect(wellsDvt({ activeCancer: true, previousDvt: true, alternativeDiagnosisLikely: true }).score).toBe(0);
  });
  it('Wells PE weights signs-of-DVT and "PE most likely" at 3 each', () => {
    expect(wellsPe({ clinicalSignsDvt: true, peMostLikely: true }).score).toBe(6);
  });
  it('CHA2DS2-VASc: female + age ≥75 + HTN', () => {
    expect(cha2ds2vasc({ sex: 'female', age: 76, hypertension: true }).score).toBe(4);
  });
});

describe('eGFR (Cockcroft-Gault)', () => {
  it('worked example: 60y, 72 kg, Scr 1.0 → 80 mL/min (male), ×0.85 female', () => {
    expect(egfrCockcroftGault({ age: 60, weightKg: 72, serumCreatinineMgDl: 1.0, sex: 'male' }).score).toBe(80);
    expect(egfrCockcroftGault({ age: 60, weightKg: 72, serumCreatinineMgDl: 1.0, sex: 'female' }).score).toBe(68);
  });
  it('throws without the required inputs', () => {
    expect(() => egfrCockcroftGault({ age: 60, weightKg: 72 })).toThrow();
  });
});

describe('Anion gap', () => {
  it('computes Na − (Cl + HCO3) and flags a high gap', () => {
    const r = anionGap({ sodium: 140, chloride: 100, bicarbonate: 24 });
    expect(r.score).toBe(16);
    expect(r.risk).toMatch(/HIGH/);
  });
  it('a normal gap is not flagged high', () => {
    expect(anionGap({ sodium: 140, chloride: 104, bicarbonate: 28 }).risk).toBe('Normal');
  });
  it('albumin correction raises the effective gap', () => {
    const r = anionGap({ sodium: 140, chloride: 100, bicarbonate: 24, albuminGDl: 2.0 });
    expect(r.detail).toContain('21'); // 16 + 2.5*(4-2) = 21
    expect(r.risk).toMatch(/HIGH/);
  });
});

describe('Killip class', () => {
  it('derives the class from the worst finding present', () => {
    expect(killip({ cardiogenicShock: true }).score).toBe(4);
    expect(killip({ pulmonaryEdema: true }).score).toBe(3);
    expect(killip({ rales: true }).score).toBe(2);
    expect(killip({}).score).toBe(1);
  });
});

describe('Centor (McIsaac)', () => {
  it('full criteria in a child scores 5', () => {
    expect(centorMcIsaac({ tonsillarExudate: true, tenderAnteriorNodes: true, feverHistory: true, noCough: true, age: 10 }).score).toBe(5);
  });
  it('age ≥45 subtracts a point', () => {
    expect(centorMcIsaac({ age: 50 }).score).toBe(-1);
  });
});

describe('Paediatric maintenance fluid (Holliday-Segar / 4-2-1)', () => {
  it('10 kg → 1000 mL/day, 20 kg → 1500, 25 kg → 1600', () => {
    expect(pediatricMaintenanceFluid({ weightKg: 10 }).score).toBe(1000);
    expect(pediatricMaintenanceFluid({ weightKg: 20 }).score).toBe(1500);
    expect(pediatricMaintenanceFluid({ weightKg: 25 }).score).toBe(1600);
  });
  it('reports the hourly 4-2-1 rate in the detail', () => {
    expect(pediatricMaintenanceFluid({ weightKg: 10 }).detail).toContain('40 mL/hr');
    expect(pediatricMaintenanceFluid({ weightKg: 25 }).detail).toContain('65 mL/hr');
  });
});

describe('Pediatric weight-based dose', () => {
  it('mg/kg × kg, per-day, and adult max cap', () => {
    expect(pediatricDose({ mgPerKg: 15, weightKg: 10, dosesPerDay: 3 }).score).toBe(150);
    expect(pediatricDose({ mgPerKg: 15, weightKg: 50, maxSingleMg: 500 }).detail).toContain('capped');
  });
});

describe('registry', () => {
  it('exposes every new tool by id and computes through the dispatcher', () => {
    for (const id of ['curb65', 'crb65', 'qsofa', 'gcs', 'wells_dvt', 'wells_pe', 'cha2ds2vasc', 'egfr', 'anion_gap', 'killip', 'centor', 'peds_fluid', 'pediatric_dose']) {
      expect(AVAILABLE_CLINICAL_TOOLS).toContain(id);
    }
    expect(computeClinicalTool('crb65', { age: 70, confusion: true }).tool).toBe('CRB-65');
    expect(() => computeClinicalTool('not_a_tool', {})).toThrow();
  });
});
