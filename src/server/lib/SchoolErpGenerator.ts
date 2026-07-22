// School / Education-ERP domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the CrmGenerator / HospitalErpGenerator recipe pattern. The real guarantees — the things that
// make this a genuine feature, not a stub — are:
//   1. ATTENDANCE IDEMPOTENCY: marking a student's attendance for a (class, date) is idempotent — a repeat
//      mark UPDATES the same record (latest status wins), never a duplicate; a student not enrolled in the
//      class is rejected.
//   2. GRADE VALIDITY: a recorded score is an integer/number in 0..maxMarks (out-of-range rejected), and a
//      student's percentage is computed EXACTLY from the recorded scores.
//   3. FEE-LEDGER INTEGRITY: a student's fee balance is ALWAYS exactly sum(invoiced) − sum(paid); a payment
//      greater than the outstanding balance is rejected (no negative balance), and every change is an
//      append-only ledger entry.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const SCHOOL_SERVICE_SOURCE = `// School / Education-ERP domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) Attendance is IDEMPOTENT per (student, class, date) — a repeat mark updates, never duplicates.
//  2) Grades are validated (0..maxMarks) and percentages are computed exactly.
//  3) The fee ledger is exact: balance = invoiced − paid, never negative, append-only.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export interface Student {
  id: string;
  name: string;
  rollNo: string;
  classId: string;
  guardianPhone?: string;
  createdAt: number;
}

export interface SchoolClass {
  id: string;
  name: string;      // e.g. "Grade 8-B"
  teacherId?: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface AttendanceRecord {
  id: string;
  studentId: string;
  classId: string;
  date: string;      // ISO yyyy-mm-dd
  status: AttendanceStatus;
  markedAt: number;
}

export interface Assessment {
  id: string;
  classId: string;
  title: string;     // e.g. "Maths Unit Test 1"
  maxMarks: number;
}

export interface Grade {
  id: string;
  assessmentId: string;
  studentId: string;
  score: number;
  recordedAt: number;
}

export interface FeeLedgerEntry {
  id: string;
  studentId: string;
  kind: 'invoice' | 'payment';
  amount: number;    // positive
  note?: string;
  at: number;
}

export class EnrollmentError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EnrollmentError'; }
}
export class GradeRangeError extends Error {
  constructor(score: number, maxMarks: number) {
    super(\`Score \${score} is out of range 0..\${maxMarks}\`);
    this.name = 'GradeRangeError';
  }
}
export class PaymentError extends Error {
  constructor(msg: string) { super(msg); this.name = 'PaymentError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class SchoolService {
  private classes = new Map<string, SchoolClass>();
  private students = new Map<string, Student>();
  private attendance = new Map<string, AttendanceRecord>();       // keyed by \`\${studentId}|\${classId}|\${date}\`
  private assessments = new Map<string, Assessment>();
  private grades = new Map<string, Grade>();                      // keyed by \`\${assessmentId}|\${studentId}\`
  private feeLedger: FeeLedgerEntry[] = [];

  // ---- Classes & students ----
  createClass(data: { name: string; teacherId?: string }): SchoolClass {
    if (!data.name?.trim()) throw new Error('Class name is required');
    const cls: SchoolClass = { id: nextId('cls'), name: data.name.trim(), teacherId: data.teacherId };
    this.classes.set(cls.id, cls);
    return cls;
  }

  enroll(data: { name: string; rollNo: string; classId: string; guardianPhone?: string }): Student {
    if (!this.classes.has(data.classId)) throw new EnrollmentError(\`Unknown class \${data.classId}\`);
    if (!data.name?.trim()) throw new Error('Student name is required');
    const student: Student = {
      id: nextId('stu'), name: data.name.trim(), rollNo: data.rollNo, classId: data.classId,
      guardianPhone: data.guardianPhone, createdAt: Date.now(),
    };
    this.students.set(student.id, student);
    return student;
  }

  roster(classId: string): Student[] {
    return [...this.students.values()].filter((s) => s.classId === classId);
  }

  // ---- Attendance (idempotent per student+class+date) ----
  markAttendance(data: { studentId: string; classId: string; date: string; status: AttendanceStatus }): AttendanceRecord {
    const student = this.students.get(data.studentId);
    if (!student) throw new EnrollmentError(\`Unknown student \${data.studentId}\`);
    if (student.classId !== data.classId) throw new EnrollmentError('Student is not enrolled in that class');
    const key = \`\${data.studentId}|\${data.classId}|\${data.date}\`;
    const existing = this.attendance.get(key);
    if (existing) {
      // idempotent update — same record, latest status wins (never a duplicate row)
      existing.status = data.status;
      existing.markedAt = Date.now();
      return existing;
    }
    const rec: AttendanceRecord = {
      id: nextId('att'), studentId: data.studentId, classId: data.classId, date: data.date,
      status: data.status, markedAt: Date.now(),
    };
    this.attendance.set(key, rec);
    return rec;
  }

  attendanceFor(studentId: string): AttendanceRecord[] {
    return [...this.attendance.values()].filter((a) => a.studentId === studentId).sort((a, b) => a.date.localeCompare(b.date));
  }

  attendanceRate(studentId: string): number {
    const recs = this.attendanceFor(studentId);
    if (recs.length === 0) return 0;
    const present = recs.filter((r) => r.status === 'present' || r.status === 'late').length;
    return present / recs.length;
  }

  // ---- Assessments & grades (0..maxMarks) ----
  createAssessment(data: { classId: string; title: string; maxMarks: number }): Assessment {
    if (!this.classes.has(data.classId)) throw new Error(\`Unknown class \${data.classId}\`);
    if (!(data.maxMarks > 0)) throw new Error('maxMarks must be positive');
    const a: Assessment = { id: nextId('asm'), classId: data.classId, title: data.title, maxMarks: data.maxMarks };
    this.assessments.set(a.id, a);
    return a;
  }

  recordGrade(data: { assessmentId: string; studentId: string; score: number }): Grade {
    const asm = this.assessments.get(data.assessmentId);
    if (!asm) throw new Error(\`Unknown assessment \${data.assessmentId}\`);
    if (!this.students.has(data.studentId)) throw new EnrollmentError(\`Unknown student \${data.studentId}\`);
    if (data.score < 0 || data.score > asm.maxMarks) throw new GradeRangeError(data.score, asm.maxMarks);
    const key = \`\${data.assessmentId}|\${data.studentId}\`;
    const existing = this.grades.get(key);
    if (existing) { existing.score = data.score; existing.recordedAt = Date.now(); return existing; }
    const g: Grade = { id: nextId('grd'), assessmentId: data.assessmentId, studentId: data.studentId, score: data.score, recordedAt: Date.now() };
    this.grades.set(key, g);
    return g;
  }

  // Exact percentage across all graded assessments for a student.
  percentage(studentId: string): number {
    const gs = [...this.grades.values()].filter((g) => g.studentId === studentId);
    if (gs.length === 0) return 0;
    let got = 0, total = 0;
    for (const g of gs) {
      const asm = this.assessments.get(g.assessmentId);
      if (!asm) continue;
      got += g.score;
      total += asm.maxMarks;
    }
    return total === 0 ? 0 : (got / total) * 100;
  }

  // ---- Fee ledger (balance = invoiced − paid, never negative, append-only) ----
  invoiceFee(studentId: string, amount: number, note?: string): FeeLedgerEntry {
    if (!this.students.has(studentId)) throw new EnrollmentError(\`Unknown student \${studentId}\`);
    if (!(amount > 0)) throw new PaymentError('Invoice amount must be positive');
    const e: FeeLedgerEntry = { id: nextId('fee'), studentId, kind: 'invoice', amount, note, at: Date.now() };
    this.feeLedger.push(e);
    return e;
  }

  payFee(studentId: string, amount: number, note?: string): FeeLedgerEntry {
    if (!(amount > 0)) throw new PaymentError('Payment amount must be positive');
    const balance = this.feeBalance(studentId);
    if (amount > balance) throw new PaymentError(\`Payment \${amount} exceeds the outstanding balance \${balance}\`);
    const e: FeeLedgerEntry = { id: nextId('fee'), studentId, kind: 'payment', amount, note, at: Date.now() };
    this.feeLedger.push(e);
    return e;
  }

  feeBalance(studentId: string): number {
    let invoiced = 0, paid = 0;
    for (const e of this.feeLedger) {
      if (e.studentId !== studentId) continue;
      if (e.kind === 'invoice') invoiced += e.amount; else paid += e.amount;
    }
    return invoiced - paid;
  }

  feeHistory(studentId: string): FeeLedgerEntry[] {
    return this.feeLedger.filter((e) => e.studentId === studentId);
  }
}

export const school = new SchoolService();
`;

export const SCHOOL_ROUTES_SOURCE = `import { Router } from 'express';
import { school, EnrollmentError, GradeRangeError, PaymentError } from './schoolService';

export const schoolRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (e) {
    if (e instanceof GradeRangeError || e instanceof PaymentError) { res.status(409).json({ error: e.message }); return; }
    if (e instanceof EnrollmentError) { res.status(404).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

schoolRouter.post('/classes', (req, res) => handle(res, () => school.createClass(req.body)));
schoolRouter.post('/students', (req, res) => handle(res, () => school.enroll(req.body)));
schoolRouter.get('/classes/:id/roster', (req, res) => handle(res, () => school.roster(req.params.id)));

schoolRouter.post('/attendance', (req, res) => handle(res, () => school.markAttendance(req.body)));
schoolRouter.get('/students/:id/attendance', (req, res) => handle(res, () => school.attendanceFor(req.params.id)));
schoolRouter.get('/students/:id/attendance/rate', (req, res) => handle(res, () => ({ rate: school.attendanceRate(req.params.id) })));

schoolRouter.post('/assessments', (req, res) => handle(res, () => school.createAssessment(req.body)));
schoolRouter.post('/grades', (req, res) => handle(res, () => school.recordGrade(req.body)));         // 409 on out-of-range
schoolRouter.get('/students/:id/percentage', (req, res) => handle(res, () => ({ percentage: school.percentage(req.params.id) })));

schoolRouter.post('/fees/invoice', (req, res) => handle(res, () => school.invoiceFee(req.body?.studentId, Number(req.body?.amount), req.body?.note)));
schoolRouter.post('/fees/pay', (req, res) => handle(res, () => school.payFee(req.body?.studentId, Number(req.body?.amount), req.body?.note))); // 409 if > balance
schoolRouter.get('/students/:id/fees', (req, res) => handle(res, () => ({ balance: school.feeBalance(req.params.id), history: school.feeHistory(req.params.id) })));
`;

export const SCHOOL_README = `# School / Education-ERP starter

A dependency-free school / education backend under \`server/school/\`, wired for Express.

## Real guarantees (not a stub)
- **Idempotent attendance** — marking a student's attendance for a (class, date) is idempotent: a repeat
  mark **updates** the same record (latest status wins), never a duplicate. A student not enrolled in the
  class is rejected (**404**).
- **Valid grades** — a recorded score must be within \`0..maxMarks\` (**409** otherwise); a student's
  percentage is computed exactly from the recorded scores.
- **Exact fee ledger** — a student's balance is always \`sum(invoiced) − sum(paid)\`; a payment greater than
  the outstanding balance is rejected (**409**, never negative); every change is an append-only entry.

## Endpoints (mount with \`app.use("/api", schoolRouter)\`)
- \`POST /classes\`, \`POST /students\`, \`GET /classes/:id/roster\`
- \`POST /attendance\`, \`GET /students/:id/attendance\`, \`GET /students/:id/attendance/rate\`
- \`POST /assessments\`, \`POST /grades\` (**409** if out of range), \`GET /students/:id/percentage\`
- \`POST /fees/invoice\`, \`POST /fees/pay\` (**409** if > balance), \`GET /students/:id/fees\`

In-memory by default; swap the Maps in \`schoolService.ts\` for your DB, keeping the same contracts.
Pairs with the auth, notification (guardian SMS) and payment recipes.
`;

export interface SchoolErpConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'School / Education-ERP starter wired under server/school/ (dependency-free domain logic + an Express router). ' +
  'Three real guarantees: (1) IDEMPOTENT ATTENDANCE — marking a (student, class, date) is idempotent (repeat ' +
  'mark updates, never duplicates; 404 if the student is not enrolled in the class); (2) VALID GRADES — a score ' +
  'must be within 0..maxMarks (409 otherwise) and percentages are computed exactly; (3) EXACT FEE LEDGER — ' +
  'balance = invoiced − paid, a payment over the balance is rejected (409, never negative), append-only. ' +
  'Endpoints: POST /classes, POST /students, GET /classes/:id/roster, POST /attendance, GET ' +
  '/students/:id/attendance(/rate), POST /assessments, POST /grades, GET /students/:id/percentage, POST ' +
  '/fees/invoice, POST /fees/pay, GET /students/:id/fees. Mount with app.use("/api", schoolRouter). In-memory ' +
  'by default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/payment recipes. No key.';

export function generateSchoolErpIntegration(): SchoolErpConfig {
  return {
    files: {
      'server/school/schoolService.ts': SCHOOL_SERVICE_SOURCE,
      'server/school/routes.ts': SCHOOL_ROUTES_SOURCE,
      'server/school/README.md': SCHOOL_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
