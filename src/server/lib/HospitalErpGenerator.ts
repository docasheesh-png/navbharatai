// Hospital-ERP / EMR domain-vertical starter generator (Roadmap remaining #12).
//
// Mirrors the CrmGenerator / EventsGenerator recipe pattern: a pure generator that emits a real,
// dependency-free domain service + an Express router + a README, wired via the `generate_hospital_erp`
// tool. The CRM recipe's real guarantee is a sales-stage STATE-MACHINE; this recipe's real guarantees —
// the things that make it a genuine feature, not a stub — are:
//   1. APPOINTMENT DOUBLE-BOOKING PREVENTION: a doctor can never hold two appointments whose time ranges
//      overlap (bookAppointment throws → the router returns 409). This is the testable invariant.
//   2. ROLE-BASED ACCESS (RBAC): a permission matrix (admin / doctor / nurse / receptionist) gates who may
//      read vs. write patient records — enforced in the service, not just the UI.
//   3. AUDIT LOG: every write to a patient record appends an immutable audit entry (who / what / when).
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const HOSPITAL_SERVICE_SOURCE = `// Hospital-ERP / EMR domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) No double-booking: a doctor cannot hold two overlapping appointments (bookAppointment throws).
//  2) RBAC: canEdit()/canView() enforce a role → permission matrix on patient records.
//  3) Audit: every record write appends an immutable audit entry.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type Role = 'admin' | 'doctor' | 'nurse' | 'receptionist';

export interface Patient {
  id: string;
  name: string;
  dob: string;            // ISO date
  mrn: string;            // medical record number
  bloodGroup?: string;
  allergies: string[];
  createdAt: number;
}

export interface EncounterNote {
  id: string;
  patientId: string;
  authorId: string;
  authorRole: Role;
  text: string;
  createdAt: number;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  startsAt: number;       // epoch ms
  endsAt: number;         // epoch ms
  status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled';
  reason?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorRole: Role;
  action: string;         // e.g. 'patient.create', 'note.add'
  targetId: string;
  at: number;
}

export class DoubleBookingError extends Error {
  constructor(doctorId: string) {
    super(\`Doctor \${doctorId} already has an appointment overlapping that time slot\`);
    this.name = 'DoubleBookingError';
  }
}

export class AccessDeniedError extends Error {
  constructor(role: Role, action: string) {
    super(\`Role "\${role}" is not permitted to \${action}\`);
    this.name = 'AccessDeniedError';
  }
}

// RBAC matrix — the single source of truth for who may do what.
// write = create/update patient records + notes; read = view patient records.
const CAN_WRITE: Record<Role, boolean> = { admin: true, doctor: true, nurse: true, receptionist: false };
const CAN_VIEW: Record<Role, boolean> = { admin: true, doctor: true, nurse: true, receptionist: true };

export function canEdit(role: Role): boolean { return CAN_WRITE[role] === true; }
export function canView(role: Role): boolean { return CAN_VIEW[role] === true; }

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class HospitalService {
  private patients = new Map<string, Patient>();
  private notes = new Map<string, EncounterNote>();
  private appointments = new Map<string, Appointment>();
  private audit: AuditEntry[] = [];

  private log(actorId: string, actorRole: Role, action: string, targetId: string): void {
    this.audit.push({ id: nextId('aud'), actorId, actorRole, action, targetId, at: Date.now() });
  }

  // ---- Patients (RBAC + audit) ----
  createPatient(
    actor: { id: string; role: Role },
    data: { name: string; dob: string; mrn: string; bloodGroup?: string; allergies?: string[] },
  ): Patient {
    if (!canEdit(actor.role)) throw new AccessDeniedError(actor.role, 'create a patient record');
    const patient: Patient = {
      id: nextId('pat'),
      name: data.name,
      dob: data.dob,
      mrn: data.mrn,
      bloodGroup: data.bloodGroup,
      allergies: data.allergies ?? [],
      createdAt: Date.now(),
    };
    this.patients.set(patient.id, patient);
    this.log(actor.id, actor.role, 'patient.create', patient.id);
    return patient;
  }

  getPatient(actor: { id: string; role: Role }, patientId: string): Patient | undefined {
    if (!canView(actor.role)) throw new AccessDeniedError(actor.role, 'view a patient record');
    return this.patients.get(patientId);
  }

  listPatients(actor: { id: string; role: Role }): Patient[] {
    if (!canView(actor.role)) throw new AccessDeniedError(actor.role, 'list patient records');
    return [...this.patients.values()];
  }

  addNote(actor: { id: string; role: Role }, patientId: string, text: string): EncounterNote {
    if (!canEdit(actor.role)) throw new AccessDeniedError(actor.role, 'add a clinical note');
    if (!this.patients.has(patientId)) throw new Error(\`Unknown patient \${patientId}\`);
    const note: EncounterNote = {
      id: nextId('note'), patientId, authorId: actor.id, authorRole: actor.role, text, createdAt: Date.now(),
    };
    this.notes.set(note.id, note);
    this.log(actor.id, actor.role, 'note.add', patientId);
    return note;
  }

  notesFor(actor: { id: string; role: Role }, patientId: string): EncounterNote[] {
    if (!canView(actor.role)) throw new AccessDeniedError(actor.role, 'view clinical notes');
    return [...this.notes.values()].filter((n) => n.patientId === patientId).sort((a, b) => a.createdAt - b.createdAt);
  }

  // ---- Appointments (double-booking prevention) ----
  bookAppointment(
    actor: { id: string; role: Role },
    data: { patientId: string; doctorId: string; startsAt: number; endsAt: number; reason?: string },
  ): Appointment {
    if (data.endsAt <= data.startsAt) throw new Error('Appointment end must be after its start');
    // The core invariant: no overlapping appointment for the same doctor (ignoring cancelled ones).
    for (const a of this.appointments.values()) {
      if (a.doctorId !== data.doctorId || a.status === 'cancelled') continue;
      const overlaps = data.startsAt < a.endsAt && a.startsAt < data.endsAt;
      if (overlaps) throw new DoubleBookingError(data.doctorId);
    }
    const appt: Appointment = {
      id: nextId('appt'),
      patientId: data.patientId,
      doctorId: data.doctorId,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      status: 'scheduled',
      reason: data.reason,
    };
    this.appointments.set(appt.id, appt);
    this.log(actor.id, actor.role, 'appointment.book', appt.id);
    return appt;
  }

  setAppointmentStatus(actor: { id: string; role: Role }, id: string, status: Appointment['status']): Appointment {
    const appt = this.appointments.get(id);
    if (!appt) throw new Error(\`Unknown appointment \${id}\`);
    appt.status = status;
    this.log(actor.id, actor.role, \`appointment.\${status}\`, id);
    return appt;
  }

  listAppointments(filter?: { doctorId?: string; patientId?: string }): Appointment[] {
    return [...this.appointments.values()].filter((a) =>
      (!filter?.doctorId || a.doctorId === filter.doctorId) &&
      (!filter?.patientId || a.patientId === filter.patientId),
    ).sort((a, b) => a.startsAt - b.startsAt);
  }

  // ---- Audit (immutable read) ----
  auditTrail(): AuditEntry[] {
    return [...this.audit];
  }
}

export const hospital = new HospitalService();
`;

export const HOSPITAL_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { hospital, DoubleBookingError, AccessDeniedError, type Role } from './hospitalService';

export const hospitalRouter = Router();

// DEMO auth shim — replace with your real auth middleware. The actor (id + role) drives RBAC.
function actorOf(req: Request): { id: string; role: Role } {
  const role = (req.header('x-role') as Role) || 'receptionist';
  const id = req.header('x-user-id') || 'anon';
  return { id, role };
}

function handle(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (e) {
    if (e instanceof AccessDeniedError) { res.status(403).json({ error: e.message }); return; }
    if (e instanceof DoubleBookingError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

hospitalRouter.get('/patients', (req, res) => handle(res, () => hospital.listPatients(actorOf(req))));
hospitalRouter.post('/patients', (req, res) => handle(res, () => hospital.createPatient(actorOf(req), req.body)));
hospitalRouter.get('/patients/:id', (req, res) => handle(res, () => hospital.getPatient(actorOf(req), req.params.id)));
hospitalRouter.get('/patients/:id/notes', (req, res) => handle(res, () => hospital.notesFor(actorOf(req), req.params.id)));
hospitalRouter.post('/patients/:id/notes', (req, res) => handle(res, () => hospital.addNote(actorOf(req), req.params.id, String(req.body?.text ?? ''))));

hospitalRouter.get('/appointments', (req, res) => handle(res, () => hospital.listAppointments({
  doctorId: req.query.doctorId as string | undefined,
  patientId: req.query.patientId as string | undefined,
})));
hospitalRouter.post('/appointments', (req, res) => handle(res, () => hospital.bookAppointment(actorOf(req), req.body)));
hospitalRouter.patch('/appointments/:id/status', (req, res) => handle(res, () => hospital.setAppointmentStatus(actorOf(req), req.params.id, req.body?.status)));

hospitalRouter.get('/audit', (_req, res) => handle(res, () => hospital.auditTrail()));
`;

export const HOSPITAL_README = `# Hospital-ERP / EMR starter

A dependency-free hospital / EMR backend under \`server/hospital/\`, wired for Express.

## Real guarantees (not a stub)
- **No double-booking** — \`bookAppointment()\` rejects any appointment that overlaps an existing
  (non-cancelled) appointment for the same doctor. The router returns **409** on conflict.
- **Role-based access (RBAC)** — a permission matrix gates patient-record writes. \`admin\`, \`doctor\`
  and \`nurse\` may write; \`receptionist\` is read-only. Everyone may view. A blocked write is **403**.
- **Audit log** — every record write (patient create, note add, appointment change) appends an
  immutable audit entry (\`GET /audit\`).

## Endpoints (mount with \`app.use("/api", hospitalRouter)\`)
- \`GET/POST /patients\`, \`GET /patients/:id\`, \`GET/POST /patients/:id/notes\`
- \`GET/POST /appointments\` (**409** on a doctor double-book), \`PATCH /appointments/:id/status\`
- \`GET /audit\`

The demo auth shim reads \`x-role\` / \`x-user-id\` headers — replace it with your real auth middleware.
In-memory by default; swap the Maps in \`hospitalService.ts\` for your DB, keeping the same contracts.
Pairs with the auth, RBAC and audit-log recipes.
`;

export interface HospitalErpConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Hospital-ERP / EMR starter wired under server/hospital/ (dependency-free domain logic + an Express router). ' +
  'Three real guarantees: (1) NO DOUBLE-BOOKING — bookAppointment() rejects any appointment overlapping an ' +
  'existing non-cancelled one for the same doctor (router returns 409); (2) RBAC — a role→permission matrix ' +
  'gates patient-record writes (admin/doctor/nurse write, receptionist read-only; 403 on a blocked write); ' +
  '(3) AUDIT — every record write appends an immutable audit entry (GET /audit). Endpoints: GET/POST /patients, ' +
  'GET /patients/:id, GET/POST /patients/:id/notes, GET/POST /appointments, PATCH /appointments/:id/status, ' +
  'GET /audit. Mount with app.use("/api", hospitalRouter). The demo auth shim reads x-role/x-user-id headers — ' +
  'replace with real auth. In-memory by default — swap the Maps for your DB, same contracts. No API key.';

export function generateHospitalErpIntegration(): HospitalErpConfig {
  return {
    files: {
      'server/hospital/hospitalService.ts': HOSPITAL_SERVICE_SOURCE,
      'server/hospital/routes.ts': HOSPITAL_ROUTES_SOURCE,
      'server/hospital/README.md': HOSPITAL_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
