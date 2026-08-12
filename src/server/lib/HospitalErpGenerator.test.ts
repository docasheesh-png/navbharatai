import { describe, it, expect, afterAll } from 'vitest';

import { generateHospitalErpIntegration, HOSPITAL_SERVICE_SOURCE } from './HospitalErpGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateHospitalErpIntegration (wiring)', () => {
  it('emits the hospital service, routes and README + express dep', () => {
    const out = generateHospitalErpIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/hospital/hospitalService.ts');
    expect(paths).toContain('server/hospital/routes.ts');
    expect(paths).toContain('server/hospital/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    // the router surfaces the two real HTTP guarantees: 409 (double-book) + 403 (RBAC)
    expect(out.files['server/hospital/routes.ts']).toContain('409');
    expect(out.files['server/hospital/routes.ts']).toContain('403');
    expect(out.files['server/hospital/routes.ts']).toContain('export const hospitalRouter');
  });
});

// Materialize + execute the emitted domain logic — the three guarantees (no double-booking, RBAC, audit)
// are real invariants, verified against the actual emitted code (same approach as CrmGenerator.test.ts).
describe('emitted HospitalService — real domain invariants', () => {
  const emitted = emitModule('hospital', HOSPITAL_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Role = 'admin' | 'doctor' | 'nurse' | 'receptionist';
  interface Patient { id: string; name: string; mrn: string }
  interface Appointment { id: string; doctorId: string; status: string }
  interface Actor { id: string; role: Role }
  interface Service {
    createPatient(a: Actor, d: { name: string; dob: string; mrn: string; allergies?: string[] }): Patient;
    listPatients(a: Actor): Patient[];
    getPatient(a: Actor, id: string): Patient | undefined;
    addNote(a: Actor, patientId: string, text: string): unknown;
    bookAppointment(a: Actor, d: { patientId: string; doctorId: string; startsAt: number; endsAt: number }): Appointment;
    setAppointmentStatus(a: Actor, id: string, s: string): Appointment;
    listAppointments(f?: { doctorId?: string }): Appointment[];
    auditTrail(): Array<{ action: string; actorRole: Role }>;
  }
  interface Emitted { HospitalService: new () => Service; canEdit(r: Role): boolean; canView(r: Role): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  const admin: Actor = { id: 'a1', role: 'admin' };
  const doctor: Actor = { id: 'd1', role: 'doctor' };
  const reception: Actor = { id: 'r1', role: 'receptionist' };

  it('RBAC matrix — receptionist cannot write, everyone can view', async () => {
    const { canEdit, canView } = await load();
    expect(canEdit('admin')).toBe(true);
    expect(canEdit('doctor')).toBe(true);
    expect(canEdit('nurse')).toBe(true);
    expect(canEdit('receptionist')).toBe(false);
    for (const r of ['admin', 'doctor', 'nurse', 'receptionist'] as Role[]) expect(canView(r)).toBe(true);
  });

  it('BLOCKS a receptionist from creating a patient record (403-class), allows a doctor', async () => {
    const { HospitalService } = await load();
    const svc = new HospitalService();
    expect(() => svc.createPatient(reception, { name: 'Asha', dob: '1990-01-01', mrn: 'MRN1' }))
      .toThrow(/not permitted/);
    const p = svc.createPatient(doctor, { name: 'Asha', dob: '1990-01-01', mrn: 'MRN1' });
    expect(p.name).toBe('Asha');
    // but a receptionist CAN view (read-only role)
    expect(svc.listPatients(reception).length).toBe(1);
  });

  it('PREVENTS a doctor double-booking an overlapping slot (409-class), allows non-overlap', async () => {
    const { HospitalService } = await load();
    const svc = new HospitalService();
    const p = svc.createPatient(admin, { name: 'Ravi', dob: '1980-05-05', mrn: 'MRN2' });
    svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 1000, endsAt: 2000 });
    // overlapping same doctor → rejected
    expect(() => svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 1500, endsAt: 2500 }))
      .toThrow(/overlapping/);
    // adjacent (no overlap) same doctor → allowed
    const ok = svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 2000, endsAt: 3000 });
    expect(ok.status).toBe('scheduled');
    // same slot but a DIFFERENT doctor → allowed
    const ok2 = svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd2', startsAt: 1500, endsAt: 2500 });
    expect(ok2.doctorId).toBe('d2');
  });

  it('a CANCELLED appointment frees the slot (no longer blocks a re-book)', async () => {
    const { HospitalService } = await load();
    const svc = new HospitalService();
    const p = svc.createPatient(admin, { name: 'Sara', dob: '1975-03-03', mrn: 'MRN3' });
    const a = svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 1000, endsAt: 2000 });
    svc.setAppointmentStatus(admin, a.id, 'cancelled');
    // the same slot is now bookable again
    const b = svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 1000, endsAt: 2000 });
    expect(b.status).toBe('scheduled');
  });

  it('rejects an appointment whose end is not after its start', async () => {
    const { HospitalService } = await load();
    const svc = new HospitalService();
    const p = svc.createPatient(admin, { name: 'X', dob: '2000-01-01', mrn: 'MRN4' });
    expect(() => svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 2000, endsAt: 2000 }))
      .toThrow(/end must be after/);
  });

  it('AUDIT log records every write (patient create, note add, appointment book)', async () => {
    const { HospitalService } = await load();
    const svc = new HospitalService();
    const p = svc.createPatient(doctor, { name: 'Meera', dob: '1995-09-09', mrn: 'MRN5' });
    svc.addNote(doctor, p.id, 'seen in OPD');
    svc.bookAppointment(doctor, { patientId: p.id, doctorId: 'd1', startsAt: 1000, endsAt: 2000 });
    const actions = svc.auditTrail().map((e) => e.action);
    expect(actions).toContain('patient.create');
    expect(actions).toContain('note.add');
    expect(actions).toContain('appointment.book');
    // audit is append-only from the caller's view — a returned copy never mutates the internal log
    svc.auditTrail().pop();
    expect(svc.auditTrail().length).toBe(3);
  });
});
