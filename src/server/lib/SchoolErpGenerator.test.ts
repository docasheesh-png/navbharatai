import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSchoolErpIntegration, SCHOOL_SERVICE_SOURCE } from './SchoolErpGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateSchoolErpIntegration (wiring)', () => {
  it('emits the school service, routes and README + express dep', () => {
    const out = generateSchoolErpIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/school/schoolService.ts');
    expect(paths).toContain('server/school/routes.ts');
    expect(paths).toContain('server/school/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/school/routes.ts']).toContain('409');
    expect(out.files['server/school/routes.ts']).toContain('export const schoolRouter');
  });
});

// Materialize + execute the emitted domain logic — the three guarantees (idempotent attendance, grade
// validity, fee-ledger integrity) are real invariants, verified against the actual emitted code.
describe('emitted SchoolService — real domain invariants', () => {
  const artifact = join(here, `._school_emitted_${process.pid}.ts`);
  writeFileSync(artifact, SCHOOL_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Cls { id: string }
  interface Student { id: string; classId: string }
  interface Assessment { id: string; maxMarks: number }
  interface Service {
    createClass(d: { name: string }): Cls;
    enroll(d: { name: string; rollNo: string; classId: string }): Student;
    roster(classId: string): Student[];
    markAttendance(d: { studentId: string; classId: string; date: string; status: string }): { id: string; status: string };
    attendanceFor(studentId: string): unknown[];
    attendanceRate(studentId: string): number;
    createAssessment(d: { classId: string; title: string; maxMarks: number }): Assessment;
    recordGrade(d: { assessmentId: string; studentId: string; score: number }): { score: number };
    percentage(studentId: string): number;
    invoiceFee(studentId: string, amount: number): unknown;
    payFee(studentId: string, amount: number): unknown;
    feeBalance(studentId: string): number;
  }
  interface Emitted { SchoolService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }
  async function seed() {
    const { SchoolService } = await load();
    const svc = new SchoolService();
    const cls = svc.createClass({ name: 'Grade 8-B' });
    const stu = svc.enroll({ name: 'Aarav', rollNo: '8B-01', classId: cls.id });
    return { svc, cls, stu };
  }

  it('ATTENDANCE is idempotent per (student, class, date) — a repeat mark updates, never duplicates', async () => {
    const { svc, cls, stu } = await seed();
    svc.markAttendance({ studentId: stu.id, classId: cls.id, date: '2026-07-21', status: 'absent' });
    const r2 = svc.markAttendance({ studentId: stu.id, classId: cls.id, date: '2026-07-21', status: 'present' });
    expect(r2.status).toBe('present');
    expect(svc.attendanceFor(stu.id).length).toBe(1); // NOT two rows for the same day
  });

  it('rejects attendance for a student not enrolled in the class', async () => {
    const { svc, stu } = await seed();
    expect(() => svc.markAttendance({ studentId: stu.id, classId: 'other', date: '2026-07-21', status: 'present' }))
      .toThrow(/not enrolled/);
  });

  it('attendanceRate counts present+late over total', async () => {
    const { svc, cls, stu } = await seed();
    svc.markAttendance({ studentId: stu.id, classId: cls.id, date: '2026-07-20', status: 'present' });
    svc.markAttendance({ studentId: stu.id, classId: cls.id, date: '2026-07-21', status: 'absent' });
    svc.markAttendance({ studentId: stu.id, classId: cls.id, date: '2026-07-22', status: 'late' });
    expect(svc.attendanceRate(stu.id)).toBeCloseTo(2 / 3, 5);
  });

  it('GRADE must be within 0..maxMarks and percentage is exact', async () => {
    const { svc, cls, stu } = await seed();
    const asm = svc.createAssessment({ classId: cls.id, title: 'Maths U1', maxMarks: 50 });
    expect(() => svc.recordGrade({ assessmentId: asm.id, studentId: stu.id, score: 60 })).toThrow(/out of range/);
    expect(() => svc.recordGrade({ assessmentId: asm.id, studentId: stu.id, score: -1 })).toThrow(/out of range/);
    svc.recordGrade({ assessmentId: asm.id, studentId: stu.id, score: 40 });
    expect(svc.percentage(stu.id)).toBeCloseTo(80, 5); // 40/50
    // a repeat grade UPDATES (no double-count)
    svc.recordGrade({ assessmentId: asm.id, studentId: stu.id, score: 45 });
    expect(svc.percentage(stu.id)).toBeCloseTo(90, 5); // 45/50, not (40+45)/100
  });

  it('FEE ledger — balance = invoiced − paid, and overpayment is rejected (409-class)', async () => {
    const { svc, stu } = await seed();
    svc.invoiceFee(stu.id, 1000);
    svc.invoiceFee(stu.id, 500);
    expect(svc.feeBalance(stu.id)).toBe(1500);
    svc.payFee(stu.id, 1200);
    expect(svc.feeBalance(stu.id)).toBe(300);
    // a payment beyond the outstanding balance is rejected — balance can never go negative
    expect(() => svc.payFee(stu.id, 500)).toThrow(/exceeds the outstanding balance/);
    expect(svc.feeBalance(stu.id)).toBe(300);
    svc.payFee(stu.id, 300);
    expect(svc.feeBalance(stu.id)).toBe(0);
  });
});
