// Roadmap breadth — status page starter (a packaged domain vertical).
//
// The public service-status / incident page every SaaS has (think status.example.com). The real feature is
// DERIVED OVERALL STATUS + an APPEND-ONLY INCIDENT TIMELINE: each service COMPONENT has a health status, the
// overall system status is DERIVED as the worst component status, and an INCIDENT is posted with a timeline of
// updates (investigating → identified → monitoring → resolved) that can only be APPENDED to — resolving stamps
// resolvedAt and a resolved incident can no longer be updated. This emits a dependency-free StatusPageService
// (no crypto/deps) + an Express router + a README. Real logic, not a stub — the worst-of derivation +
// append-only timeline rules are unit-tested against the emitted code. Pure builder → the caller writes the
// files. Distinct from generate_announcements (dismissible banners) and generate_support_tickets (private queue).

export const STATUSPAGE_SERVICE_SOURCE = `// Status-page domain logic. The core guarantees: (1) each component has a health status and the OVERALL system
// status is DERIVED as the WORST component status; (2) an incident carries an APPEND-ONLY timeline of updates
// (investigating → identified → monitoring → resolved); and (3) resolving an incident stamps resolvedAt and a
// resolved incident cannot be updated further. In-memory here; swap the Maps for your database.

export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

const SEVERITY: Record<ComponentStatus, number> = {
  operational: 0, degraded: 1, partial_outage: 2, major_outage: 3,
};
const COMPONENT_STATUSES = Object.keys(SEVERITY) as ComponentStatus[];
const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

export interface Component { id: string; name: string; status: ComponentStatus }
export interface IncidentUpdate { status: IncidentStatus; message: string; at: string }
export interface Incident {
  id: string;
  title: string;
  componentIds: string[];
  status: IncidentStatus;
  createdAt: string;
  resolvedAt: string | null;
  timeline: IncidentUpdate[];
}

let counter = 0;
function nextId(prefix: string, now: Date): string {
  counter += 1;
  return prefix + '_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class StatusPageService {
  private components = new Map<string, Component>();
  private incidents = new Map<string, Incident>();

  /** Add a service component. Starts 'operational'. */
  addComponent(name: string, now: Date = new Date()): Component {
    const label = String(name ?? '').trim();
    if (!label) throw new Error('name is required');
    const c: Component = { id: nextId('cmp', now), name: label, status: 'operational' };
    this.components.set(c.id, c);
    return { ...c };
  }

  /** Set a component's health status. */
  setComponentStatus(componentId: string, status: ComponentStatus): Component {
    const c = this.components.get(String(componentId ?? '').trim());
    if (!c) throw new Error('component not found');
    if (!COMPONENT_STATUSES.includes(status)) throw new Error('invalid component status');
    c.status = status;
    return { ...c };
  }

  listComponents(): Component[] {
    return [...this.components.values()].map((c) => ({ ...c }));
  }

  /** The DERIVED overall status: the worst status across all components (operational if there are none). */
  overallStatus(): ComponentStatus {
    let worst: ComponentStatus = 'operational';
    for (const c of this.components.values()) {
      if (SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
    }
    return worst;
  }

  /**
   * Open an incident affecting some components. Starts 'investigating' with the first timeline entry. The
   * componentIds must all exist.
   */
  openIncident(title: string, message: string, componentIds: string[] = [], now: Date = new Date()): Incident {
    const t = String(title ?? '').trim();
    if (!t) throw new Error('title is required');
    const ids = (Array.isArray(componentIds) ? componentIds : []).map((x) => String(x).trim());
    for (const id of ids) if (!this.components.has(id)) throw new Error('component not found: ' + id);
    const inc: Incident = {
      id: nextId('inc', now),
      title: t,
      componentIds: ids,
      status: 'investigating',
      createdAt: now.toISOString(),
      resolvedAt: null,
      timeline: [{ status: 'investigating', message: String(message ?? '').trim(), at: now.toISOString() }],
    };
    this.incidents.set(inc.id, inc);
    return this.getIncident(inc.id) as Incident;
  }

  /**
   * Append an update to an incident's timeline. A resolved incident cannot be updated. Setting status
   * 'resolved' stamps resolvedAt.
   */
  addUpdate(incidentId: string, status: IncidentStatus, message: string, now: Date = new Date()): Incident {
    const inc = this.incidents.get(String(incidentId ?? '').trim());
    if (!inc) throw new Error('incident not found');
    if (inc.status === 'resolved') throw new Error('incident is already resolved');
    if (!INCIDENT_STATUSES.includes(status)) throw new Error('invalid incident status');
    inc.status = status;
    inc.timeline.push({ status, message: String(message ?? '').trim(), at: now.toISOString() }); // append-only
    if (status === 'resolved') inc.resolvedAt = now.toISOString();
    return this.getIncident(inc.id) as Incident;
  }

  getIncident(id: string): Incident | undefined {
    const inc = this.incidents.get(String(id ?? '').trim());
    if (!inc) return undefined;
    return { ...inc, componentIds: [...inc.componentIds], timeline: inc.timeline.map((u) => ({ ...u })) };
  }

  /** Unresolved incidents, newest first. */
  activeIncidents(): Incident[] {
    return [...this.incidents.values()]
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((i) => this.getIncident(i.id) as Incident);
  }

  /** All incidents, newest first (the incident history). */
  incidentHistory(): Incident[] {
    return [...this.incidents.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((i) => this.getIncident(i.id) as Incident);
  }

  /** The full public status snapshot. */
  snapshot(): { overall: ComponentStatus; components: Component[]; activeIncidents: Incident[] } {
    return { overall: this.overallStatus(), components: this.listComponents(), activeIncidents: this.activeIncidents() };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const statusPage = new StatusPageService();
`;

export const STATUSPAGE_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { statusPage, type ComponentStatus, type IncidentStatus } from './statusPageService';

// REST endpoints for the status page. Mount with: app.use('/api/status', statusRouter).
// The GET snapshot/history are public; guard the write routes (components + incidents) with admin auth.
export const statusRouter = Router();

// The public status snapshot: overall + components + active incidents.
statusRouter.get('/', (_req: Request, res: Response) => {
  return res.status(200).json(statusPage.snapshot());
});

// Incident history.
statusRouter.get('/incidents', (_req: Request, res: Response) => {
  return res.status(200).json(statusPage.incidentHistory());
});

// Add a component. { name }. Admin.
statusRouter.post('/components', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown };
  try {
    return res.status(201).json(statusPage.addComponent(String(body.name ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Set a component's status. { status }. Admin.
statusRouter.patch('/components/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(statusPage.setComponentStatus(req.params.id, String(body.status ?? '') as ComponentStatus));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'component not found' ? 404 : 400).json({ error: message });
  }
});

// Open an incident. { title, message, componentIds? }. Admin.
statusRouter.post('/incidents', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; message?: unknown; componentIds?: unknown };
  try {
    const ids = Array.isArray(body.componentIds) ? (body.componentIds as string[]) : [];
    return res.status(201).json(statusPage.openIncident(String(body.title ?? ''), String(body.message ?? ''), ids));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message.includes('component not found') ? 404 : 400).json({ error: message });
  }
});

// Append an update. { status, message }. 409 if the incident is already resolved. Admin.
statusRouter.post('/incidents/:id/updates', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown; message?: unknown };
  try {
    return res.status(200).json(statusPage.addUpdate(req.params.id, String(body.status ?? '') as IncidentStatus, String(body.message ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'incident not found') return res.status(404).json({ error: message });
    return res.status(message.includes('already resolved') ? 409 : 400).json({ error: message });
  }
});
`;

const STATUSPAGE_README = `# Status page

A real public service-status / incident page (like status.example.com). The core guarantees: each service
**component** has a health status and the **overall** system status is **derived** as the **worst** component
status, and each **incident** carries an **append-only** timeline of updates (investigating → identified →
monitoring → resolved) — resolving stamps \`resolvedAt\` and a resolved incident can no longer be updated. Files:

- \`statusPageService.ts\` — the domain logic (\`StatusPageService\` + a \`statusPage\` singleton). Dependency-free.
  In-memory; swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { statusRouter } from './server/status/routes';
app.use('/api/status', statusRouter);
\`\`\`

Endpoints (GETs are public; **guard the write routes with admin auth**):
- \`GET  /api/status\` → \`{ overall, components, activeIncidents }\`.
- \`GET  /api/status/incidents\` → incident history.
- \`POST /api/status/components\` \`{ name }\` → add a component.
- \`PATCH /api/status/components/:id\` \`{ status }\` → operational | degraded | partial_outage | major_outage.
- \`POST /api/status/incidents\` \`{ title, message, componentIds? }\` → open an incident.
- \`POST /api/status/incidents/:id/updates\` \`{ status, message }\` → append an update (**409** if resolved).

Component statuses are ordered operational < degraded < partial_outage < major_outage — the overall status is
the worst of them. Distinct from \`generate_announcements\` (dismissible banners) and \`generate_support_tickets\`
(a private ticket queue).
`;

export interface StatusPageConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Status page starter wired under server/status/ (dependency-free domain logic + an Express router). The real ' +
  'guarantee is DERIVED OVERALL STATUS + an APPEND-ONLY INCIDENT TIMELINE: addComponent()/setComponentStatus() ' +
  'manage components (operational|degraded|partial_outage|major_outage); overallStatus() is DERIVED as the ' +
  'WORST component status; openIncident() starts an incident (investigating) with a timeline; addUpdate() ' +
  'APPENDS to the timeline (investigating→identified→monitoring→resolved) — a resolved incident cannot be ' +
  'updated (409) and resolving stamps resolvedAt; snapshot() returns {overall, components, activeIncidents}. ' +
  'routes.ts exposes GET /api/status, GET /api/status/incidents, POST /api/status/components, PATCH ' +
  '/api/status/components/:id, POST /api/status/incidents and POST /api/status/incidents/:id/updates. Mount at ' +
  'app.use("/api/status", statusRouter); GETs are public, guard the write routes with admin auth. Distinct from ' +
  'generate_announcements (dismissible banners) and generate_support_tickets (a private queue). In-memory by ' +
  'default — swap the Maps for your DB.';

export function generateStatusPageIntegration(): StatusPageConfig {
  return {
    files: {
      'server/status/statusPageService.ts': STATUSPAGE_SERVICE_SOURCE,
      'server/status/routes.ts': STATUSPAGE_ROUTES_SOURCE,
      'server/status/README.md': STATUSPAGE_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
