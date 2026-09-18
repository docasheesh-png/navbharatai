// WHICH PORT OF THIS APP SHOULD A HUMAN LOOK AT?
//
// 🔴 THE QUESTION NOBODY WAS ASKING (autopsy `1a7f4a58`, 2026-09-18, admin-mandated the same day:
// *"ab yeh nahi ana chahiye"*).
//
// Three subsystems each held part of the answer and none was ever asked the whole question:
//
//   • `PortDiscovery` / the sweep — which port is LISTENING. A fact about a PROCESS, not about the app.
//   • `declaredPort`              — which port the app CLAIMS. One port, and an app has as many as
//                                   it has services.
//   • `serviceGraph`              — the services and their ports. Correct, and deliberately advisory:
//                                   "Nothing is started from it yet."
//
// So on a full-stack app the platform had no way to tell "a SECOND process of this app came up" from
// "the app MOVED". The consequences, all in one real build report:
//
//   SERVICE_GRAPH_SINGLE  "Single service: qiikr (frontend on port 5173)."
//   (supersede)           "superseded now that the current app is verified on port 3001"
//
// Two subsystems, one report, opposite conclusions — and the wrong one held the kill switch. It freed
// the app's own Vite server and pointed the preview at the Express API, which answers `Cannot GET /`
// because it only serves static files under `NODE_ENV=production`.
//
// 🔒 THE RULE THIS FILE EXISTS TO ENFORCE: there is ONE derivation of an app's ports, and every actor
// reads it. Not "the graph is usually right" — the same function, so a contradiction is impossible by
// construction rather than by everybody remembering to agree.
//
// ⚠️ The graph is the SPINE, not the whole answer: it reads package.json scripts, while an app also
// states ports in `.env.example`, in `listen()` and in `vite.config.ts`. `all` is the union, because
// the question the veto asks — "is this port the app's own?" — must never be answered "no" merely
// because the port was declared in a file the graph does not read.
//
// PURE — files in, answer out. No I/O, no clock, never throws.

import { buildServiceGraph, type ServiceGraph } from './serviceGraph';
import { declaredPortsFrom } from './declaredPort';

export interface AppPortMap {
  /** The port a person should be shown: the frontend when there is one, else the only service's. */
  preview: number | null;
  /** The app's web app, when it has one. */
  frontend: number | null;
  /** Every API/worker port the app's own services declare. */
  backends: number[];
  /** EVERY port this app claims, from any source. The set a veto must never free. */
  all: number[];
  /** True when the project genuinely runs more than one process. */
  multiService: boolean;
}

/**
 * The port a person should be shown, from a graph alone.
 *
 * A frontend wins whenever one exists: the API is a dependency of the web app, and a human opening a
 * "preview" means the thing with a user interface. With no frontend (a bare API, a worker project) the
 * only sensible answer is the first service that has a port at all.
 */
export function previewPortFor(graph: ServiceGraph): number | null {
  const frontend = graph.services.find((s) => s.kind === 'frontend' && s.port != null);
  if (frontend?.port != null) return frontend.port;
  const anyPort = graph.services.find((s) => s.port != null);
  return anyPort?.port ?? null;
}

/** Everything known about this app's own ports, from one derivation. Never throws. */
export function appPortsFrom(files: Record<string, string | undefined>): AppPortMap {
  const empty: AppPortMap = { preview: null, frontend: null, backends: [], all: [], multiService: false };
  try {
    const graph = buildServiceGraph({ contents: files as Record<string, string> });
    const frontend = graph.services.find((s) => s.kind === 'frontend' && s.port != null)?.port ?? null;
    const backends = graph.services.filter((s) => s.kind !== 'frontend' && s.port != null).map((s) => s.port as number);
    const all = new Set<number>();
    for (const s of graph.services) if (s.port != null) all.add(s.port);
    // The union, not the graph alone — see the header: a port declared only in `.env.example` or in a
    // `listen()` literal is still the app's own, and the veto must know that.
    for (const d of declaredPortsFrom(files)) all.add(d.port);
    return {
      preview: previewPortFor(graph),
      frontend,
      backends,
      all: [...all],
      multiService: graph.multiService,
    };
  } catch {
    return empty; // a port hint must never be able to throw on the path that only wants a hint
  }
}

/**
 * Is `port` a port of this app that is NOT the one a person should be shown?
 *
 * This is the question the health check and the port sweep needed and could not ask: the difference
 * between "a second process of this app came up" and "the app moved".
 */
export function isSecondaryAppPort(map: AppPortMap, port: number): boolean {
  return map.preview != null && port !== map.preview && map.all.includes(port);
}
