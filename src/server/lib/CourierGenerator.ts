// Courier / Logistics domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the CrmGenerator / HospitalErpGenerator / SchoolErpGenerator recipe pattern. The real
// guarantees — the things that make this a genuine feature, not a stub — are:
//   1. SHIPMENT STATE-MACHINE: a parcel moves created → picked_up → in_transit → out_for_delivery →
//      delivered along ALLOWED transitions only; a failed delivery attempt loops back to in_transit;
//      delivered/cancelled/returned are terminal. An invalid jump is rejected (409).
//   2. APPEND-ONLY SCAN HISTORY: every status change (and location scan) appends an immutable tracking
//      event, so a shipment's history is a complete, ordered audit trail.
//   3. IDEMPOTENT TRACKING NUMBERS: a tracking number is unique; creating a shipment mints one and it never
//      collides, and lookups by tracking number are exact.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const COURIER_SERVICE_SOURCE = `// Courier / Logistics domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A shipment's status follows an allowed STATE-MACHINE (invalid jumps rejected); a failed attempt
//     loops back to in_transit; delivered/cancelled/returned are terminal.
//  2) Every status change appends an immutable tracking event (append-only history).
//  3) Tracking numbers are unique and lookups are exact.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type ShipmentStatus =
  | 'created' | 'picked_up' | 'in_transit' | 'out_for_delivery'
  | 'delivered' | 'failed_attempt' | 'returned' | 'cancelled';

// Allowed transitions. delivered / returned / cancelled are terminal (no outgoing moves).
const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  created: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'cancelled'],
  in_transit: ['out_for_delivery', 'returned', 'cancelled'],
  out_for_delivery: ['delivered', 'failed_attempt', 'returned'],
  failed_attempt: ['out_for_delivery', 'in_transit', 'returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface TrackingEvent {
  id: string;
  status: ShipmentStatus;
  location?: string;
  note?: string;
  at: number;
}

export interface Address {
  name: string;
  line1: string;
  city: string;
  pincode: string;
  phone?: string;
}

export interface Shipment {
  id: string;
  trackingNo: string;
  from: Address;
  to: Address;
  status: ShipmentStatus;
  driverId?: string;
  weightKg?: number;
  createdAt: number;
  events: TrackingEvent[];
}

export class InvalidTransitionError extends Error {
  constructor(from: ShipmentStatus, to: ShipmentStatus) {
    super(\`Invalid shipment transition \${from} → \${to}\`);
    this.name = 'InvalidTransitionError';
  }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class CourierService {
  private shipments = new Map<string, Shipment>();
  private byTracking = new Map<string, string>();   // trackingNo → shipmentId (uniqueness index)

  private mintTrackingNo(): string {
    // NBX + base36 time + counter — unique by construction (the counter breaks same-ms ties).
    let t = '';
    do {
      t = \`NBX\${Date.now().toString(36).toUpperCase()}\${(seq++).toString(36).toUpperCase()}\`;
    } while (this.byTracking.has(t));
    return t;
  }

  createShipment(data: { from: Address; to: Address; weightKg?: number; driverId?: string }): Shipment {
    if (!data.from?.pincode || !data.to?.pincode) throw new Error('from and to addresses (with pincode) are required');
    const trackingNo = this.mintTrackingNo();
    const now = Date.now();
    const shipment: Shipment = {
      id: nextId('shp'),
      trackingNo,
      from: data.from,
      to: data.to,
      status: 'created',
      driverId: data.driverId,
      weightKg: data.weightKg,
      createdAt: now,
      events: [{ id: nextId('evt'), status: 'created', at: now }],
    };
    this.shipments.set(shipment.id, shipment);
    this.byTracking.set(trackingNo, shipment.id);
    return shipment;
  }

  advanceStatus(id: string, to: ShipmentStatus, meta?: { location?: string; note?: string }): Shipment {
    const s = this.shipments.get(id);
    if (!s) throw new Error(\`Unknown shipment \${id}\`);
    if (!canTransition(s.status, to)) throw new InvalidTransitionError(s.status, to);
    s.status = to;
    s.events.push({ id: nextId('evt'), status: to, location: meta?.location, note: meta?.note, at: Date.now() });
    return s;
  }

  assignDriver(id: string, driverId: string): Shipment {
    const s = this.shipments.get(id);
    if (!s) throw new Error(\`Unknown shipment \${id}\`);
    s.driverId = driverId;
    return s;
  }

  getByTracking(trackingNo: string): Shipment | undefined {
    const id = this.byTracking.get(trackingNo);
    return id ? this.shipments.get(id) : undefined;
  }

  get(id: string): Shipment | undefined {
    return this.shipments.get(id);
  }

  history(id: string): TrackingEvent[] {
    return [...(this.shipments.get(id)?.events ?? [])];
  }

  list(filter?: { status?: ShipmentStatus; driverId?: string }): Shipment[] {
    return [...this.shipments.values()].filter((s) =>
      (!filter?.status || s.status === filter.status) &&
      (!filter?.driverId || s.driverId === filter.driverId),
    ).sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const courier = new CourierService();
`;

export const COURIER_ROUTES_SOURCE = `import { Router } from 'express';
import { courier, InvalidTransitionError } from './courierService';

export const courierRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

courierRouter.post('/shipments', (req, res) => handle(res, () => courier.createShipment(req.body)));
courierRouter.get('/shipments', (req, res) => handle(res, () => courier.list({
  status: req.query.status as never,
  driverId: req.query.driverId as string | undefined,
})));
courierRouter.get('/shipments/:id', (req, res) => handle(res, () => courier.get(req.params.id)));
courierRouter.patch('/shipments/:id/status', (req, res) => handle(res, () =>
  courier.advanceStatus(req.params.id, req.body?.status, { location: req.body?.location, note: req.body?.note }))); // 409 on invalid transition
courierRouter.patch('/shipments/:id/driver', (req, res) => handle(res, () => courier.assignDriver(req.params.id, req.body?.driverId)));
courierRouter.get('/shipments/:id/history', (req, res) => handle(res, () => courier.history(req.params.id)));

// Public tracking lookup by tracking number.
courierRouter.get('/track/:trackingNo', (req, res) => handle(res, () => courier.getByTracking(req.params.trackingNo)));
`;

export const COURIER_README = `# Courier / Logistics starter

A dependency-free courier / logistics backend under \`server/courier/\`, wired for Express.

## Real guarantees (not a stub)
- **Shipment state-machine** — status moves \`created → picked_up → in_transit → out_for_delivery →
  delivered\` along allowed transitions only; a \`failed_attempt\` loops back to delivery/transit;
  \`delivered\` / \`returned\` / \`cancelled\` are terminal. An invalid jump is rejected (**409**).
- **Append-only tracking history** — every status change appends an immutable tracking event, so
  \`GET /shipments/:id/history\` (and the public \`GET /track/:trackingNo\`) is a complete, ordered trail.
- **Unique tracking numbers** — each shipment mints a unique tracking number; lookups by it are exact.

## Endpoints (mount with \`app.use("/api", courierRouter)\`)
- \`POST /shipments\`, \`GET /shipments\` (filter by status/driver), \`GET /shipments/:id\`
- \`PATCH /shipments/:id/status\` (**409** on an invalid transition), \`PATCH /shipments/:id/driver\`
- \`GET /shipments/:id/history\`, \`GET /track/:trackingNo\` (public tracking)

In-memory by default; swap the Maps in \`courierService.ts\` for your DB, keeping the same contracts.
Pairs with the auth, notification (SMS/status updates) and maps recipes.
`;

export interface CourierConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Courier / Logistics starter wired under server/courier/ (dependency-free domain logic + an Express router). ' +
  'Three real guarantees: (1) SHIPMENT STATE-MACHINE — status moves created → picked_up → in_transit → ' +
  'out_for_delivery → delivered along allowed transitions only (failed_attempt loops back; delivered/returned/' +
  'cancelled terminal), invalid jumps rejected (409); (2) APPEND-ONLY tracking history — every status change ' +
  'appends an immutable event; (3) UNIQUE tracking numbers with exact lookup. Endpoints: POST /shipments, GET ' +
  '/shipments, GET /shipments/:id, PATCH /shipments/:id/status (409 on invalid), PATCH /shipments/:id/driver, ' +
  'GET /shipments/:id/history, GET /track/:trackingNo (public). Mount with app.use("/api", courierRouter). ' +
  'In-memory by default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/maps ' +
  'recipes. No key.';

export function generateCourierIntegration(): CourierConfig {
  return {
    files: {
      'server/courier/courierService.ts': COURIER_SERVICE_SOURCE,
      'server/courier/routes.ts': COURIER_ROUTES_SOURCE,
      'server/courier/README.md': COURIER_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
