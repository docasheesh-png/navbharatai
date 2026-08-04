import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateStatusPageIntegration, STATUSPAGE_SERVICE_SOURCE } from './StatusPageGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateStatusPageIntegration (wiring)', () => {
  it('emits the status-page service, routes and README', () => {
    const out = generateStatusPageIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/status/statusPageService.ts');
    expect(paths).toContain('server/status/routes.ts');
    expect(paths).toContain('server/status/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/status/routes.ts']).toContain('export const statusRouter');
    expect(out.files['server/status/routes.ts']).toContain('/incidents');
  });
});

// Materialize + execute the emitted domain logic — the worst-of derivation + append-only timeline rules are
// real business rules, verified against the actual emitted code.
describe('emitted StatusPageService — derived overall status + append-only incidents (real logic)', () => {
  const artifact = join(here, `._statuspage_emitted_${process.pid}.ts`);
  writeFileSync(artifact, STATUSPAGE_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage';
  type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
  interface Component { id: string; name: string; status: ComponentStatus }
  interface IncidentUpdate { status: IncidentStatus; message: string; at: string }
  interface Incident { id: string; title: string; componentIds: string[]; status: IncidentStatus; createdAt: string; resolvedAt: string | null; timeline: IncidentUpdate[] }
  interface Service {
    addComponent(name: string, now?: Date): Component;
    setComponentStatus(componentId: string, status: ComponentStatus): Component;
    listComponents(): Component[];
    overallStatus(): ComponentStatus;
    openIncident(title: string, message: string, componentIds?: string[], now?: Date): Incident;
    addUpdate(incidentId: string, status: IncidentStatus, message: string, now?: Date): Incident;
    getIncident(id: string): Incident | undefined;
    activeIncidents(): Incident[];
    incidentHistory(): Incident[];
    snapshot(): { overall: ComponentStatus; components: Component[]; activeIncidents: Incident[] };
  }
  interface Emitted { StatusPageService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('THE INVARIANT: overall status is the WORST component status', async () => {
    const { StatusPageService } = await load();
    const svc = new StatusPageService();
    expect(svc.overallStatus()).toBe('operational'); // no components -> operational
    const api = svc.addComponent('API');
    const db = svc.addComponent('Database');
    expect(svc.overallStatus()).toBe('operational'); // all operational
    svc.setComponentStatus(api.id, 'degraded');
    expect(svc.overallStatus()).toBe('degraded');    // worst is degraded
    svc.setComponentStatus(db.id, 'major_outage');
    expect(svc.overallStatus()).toBe('major_outage'); // worst wins
    svc.setComponentStatus(db.id, 'operational');
    expect(svc.overallStatus()).toBe('degraded');    // back to API's degraded
  });

  it('opens an incident with a timeline and validates components', async () => {
    const { StatusPageService } = await load();
    const svc = new StatusPageService();
    const api = svc.addComponent('API');
    const inc = svc.openIncident('API latency', 'Looking into it', [api.id]);
    expect(inc.status).toBe('investigating');
    expect(inc.timeline.length).toBe(1);
    expect(inc.componentIds).toEqual([api.id]);
    expect(svc.activeIncidents().length).toBe(1);
    expect(() => svc.openIncident('', 'x')).toThrow(/title is required/);
    expect(() => svc.openIncident('T', 'x', ['ghost'])).toThrow(/component not found/);
  });

  it('THE INVARIANT: the incident timeline is append-only; a resolved incident cannot be updated', async () => {
    const { StatusPageService } = await load();
    const svc = new StatusPageService();
    const inc = svc.openIncident('Outage', 'investigating');
    svc.addUpdate(inc.id, 'identified', 'root cause found');
    svc.addUpdate(inc.id, 'monitoring', 'fix deployed');
    const resolved = svc.addUpdate(inc.id, 'resolved', 'all clear');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    // timeline appended in order, never mutated
    expect(resolved.timeline.map((u) => u.status)).toEqual(['investigating', 'identified', 'monitoring', 'resolved']);
    // a resolved incident is closed to further updates
    expect(() => svc.addUpdate(inc.id, 'monitoring', 'reopen?')).toThrow(/already resolved/);
    // and it drops off the active list but stays in history
    expect(svc.activeIncidents().length).toBe(0);
    expect(svc.incidentHistory().length).toBe(1);
  });

  it('validates unknown ids and invalid statuses', async () => {
    const { StatusPageService } = await load();
    const svc = new StatusPageService();
    expect(() => svc.setComponentStatus('nope', 'degraded')).toThrow(/component not found/);
    const c = svc.addComponent('X');
    expect(() => svc.setComponentStatus(c.id, 'exploded' as ComponentStatus)).toThrow(/invalid component status/);
    expect(() => svc.addUpdate('nope', 'identified', 'x')).toThrow(/incident not found/);
    const inc = svc.openIncident('I', 'x');
    expect(() => svc.addUpdate(inc.id, 'sideways' as IncidentStatus, 'x')).toThrow(/invalid incident status/);
  });

  it('snapshot returns overall + components + active incidents', async () => {
    const { StatusPageService } = await load();
    const svc = new StatusPageService();
    const api = svc.addComponent('API');
    svc.setComponentStatus(api.id, 'partial_outage');
    svc.openIncident('Partial outage', 'investigating', [api.id]);
    const snap = svc.snapshot();
    expect(snap.overall).toBe('partial_outage');
    expect(snap.components.length).toBe(1);
    expect(snap.activeIncidents.length).toBe(1);
  });
});
