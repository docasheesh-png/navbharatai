// PORTS THAT ARE NEVER THE USER'S APP — one list, read by everything that picks, publishes or frees a port.
//
// 🔴 WHY ONE LIST (autopsy 2b1f845e, 2026-10-01). The build told the user: "A previous app in this
// workspace was still serving on port 49983 — superseded … (old server stopped)". Port 49983 is the
// SANDBOX'S OWN agent (E2B's envd): every file read, every command and every preview this platform
// makes goes through it. Our own scan in the same build listed what was listening — `22, 111, 3000,
// 9222, 49983` — and only 3000 was the app. 22 is SSH, 111 is rpcbind, 9222 is our own browser
// daemon's debugging port (E2BActuator's CDP_PORT), 49983 is envd.
//
// Four separate lists decided "this port is not the app" and none of them knew those four:
//   • PortDiscovery's INFRA_PORTS (the preview flip that visits every LISTENING port),
//   • devServerHost's INFRA_PORTS (reading a port out of the dev server's log),
//   • previewSupersede's and DevServerRecovery's PROTECTED_PORTS (ports we must never kill).
// They had drifted from each other too (9229 in one, 1433 in two, 5672 in one). A port the flip
// visited and saw answering became the stored revival recipe, and the next build's supersede then
// tried to kill it. A list in four places is four lists; this is the one.
//
// Two kinds, kept apart only so a caller can say WHICH kind a port is:
//   • the sandbox's own machinery — never the app, never to be killed by an app-level decision;
//   • data services an app talks TO — never the app's preview, and killing one loses the app's data.
// No dev server this platform builds ever binds either kind. PURE.

/** The sandbox's own machinery: SSH, DNS, rpcbind, our browser's debugging port, Node's inspector, the sandbox agent. */
export const SANDBOX_SYSTEM_PORTS: ReadonlySet<number> = new Set([22, 53, 111, 9222, 9229, 49983]);

/** Data services an app connects to (PostgreSQL, MySQL, MSSQL, MongoDB, Redis, RabbitMQ, Elasticsearch, Memcached, Kafka, etcd). */
export const DATA_SERVICE_PORTS: ReadonlySet<number> = new Set([5432, 3306, 1433, 27017, 6379, 5672, 9200, 11211, 9092, 2379]);

/** True when this port belongs to the sandbox itself, not to anything the user built. */
export function isSandboxSystemPort(port: unknown): boolean {
  return typeof port === 'number' && SANDBOX_SYSTEM_PORTS.has(port);
}

/** True when this port is a data service (a database, a queue, a cache). */
export function isDataServicePort(port: unknown): boolean {
  return typeof port === 'number' && DATA_SERVICE_PORTS.has(port);
}

/**
 * True when this port can never be the user's app: never published as its preview, never stored as its
 * revival port, never killed to make room for it.
 */
export function isNeverAppPort(port: unknown): boolean {
  return isSandboxSystemPort(port) || isDataServicePort(port);
}
