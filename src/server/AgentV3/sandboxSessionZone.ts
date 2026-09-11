// WHY WAS THIS SANDBOX STARTED? — attribution for every create and resume, without touching a call site.
//
// THE NUMBER THAT NOBODY COULD EXPLAIN (admin's E2B dashboard, 2026-09-11): 1,110 sandbox starts and
// resumes in 30 days for ONE tester — about 37 a day. Every one of them is a billing event, and the
// actuator's own counter (`usageTracker.record(workspaceId, 'sandbox')`) says only THAT a machine
// started, never WHY. A build, the preview door's port sweep, a wake, a publish, a file read and a
// health probe all reach `getSandbox` through the same twenty-one paths, and any of them can resume a
// paused machine. Until each start carries its cause, "37 a day" is a mystery rather than a lever.
//
// HOW, WITHOUT THREADING A PARAMETER THROUGH TWENTY-ONE CALLS. The same AsyncLocalStorage pattern the
// repo already uses for the no-Claude zone and the AI-spend zone: ONE Express middleware opens a zone
// for every `/api/agentv3/*` request, naming the reason from the path; `getSandbox` reads the zone at
// the moment it creates or resumes. A caller that runs outside any request (a scheduled job) reads
// as `unattributed`, which is the honest word for it — never a guess.
//
// PURE except for the storage itself. `reasonForPath` is a table, so it is testable and a new route
// is one line, not a new mechanism.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

/** The causes a sandbox start can be attributed to. Kept short so the admin card stays readable. */
export type SandboxReason =
  | 'build'            // /chat — the build turn itself
  | 'preview-door'     // the live iframe asking "where is my app?" (a port sweep RESUMES a paused VM)
  | 'preview-diagnose' // an explicit wake / Diagnose / Restart the server
  | 'preview-health'   // the 150 s watchdog (should never start a machine — see the health route)
  | 'publish'          // publish / ship / unpublish / deploy
  | 'files'            // file reads and writes from the Files tab, imports, restores
  | 'exec'             // the terminal
  | 'version-preview'  // running an older checkpoint
  | 'visual-edit'      // the Visual Editor's exact edit
  | 'other'            // an /api/agentv3 route not classified above
  | 'unattributed';    // no request context at all (a scheduled job, a test)

interface ZoneState { reason: SandboxReason }
const storage = new AsyncLocalStorage<ZoneState>();

/**
 * Which cause a request path belongs to. Ordered from most to least specific; the first match wins.
 * A path outside the table is `other`, never `unattributed` — it DID come through a request.
 */
export function reasonForPath(path: string | null | undefined): SandboxReason {
  const p = String(path || '');
  if (/\/preview-door(\b|\/|\?|$)/.test(p)) return 'preview-door';
  if (/\/preview-diagnose(\b|\/|$)/.test(p)) return 'preview-diagnose';
  if (/\/preview-health(\b|\/|$)/.test(p)) return 'preview-health';
  if (/\/(publish|ship|unpublish|deploy-backend|deployment|rollback)(\b|\/|$)/.test(p)) return 'publish';
  if (/\/(workspace-files|import-files|restore-files|delete-files|restore|checkpoints?|checkpoint-diff)(\b|\/|$)/.test(p)) return 'files';
  if (/\/exec(\b|\/|$)/.test(p)) return 'exec';
  if (/\/version-preview(\b|\/|$)/.test(p)) return 'version-preview';
  if (/\/visual-edit(\b|\/|$)/.test(p)) return 'visual-edit';
  if (/\/(chat|respond|steer|attach)(\b|\/|$)/.test(p)) return 'build';
  return 'other';
}

/** The reason for the current async context, or `unattributed` outside any zone. */
export function currentSandboxReason(): SandboxReason {
  return storage.getStore()?.reason ?? 'unattributed';
}

/** Run `fn` inside a zone with an explicit reason (for the few callers that are not requests). */
export function inSandboxReasonZone<T>(reason: SandboxReason, fn: () => T): T {
  return storage.run({ reason }, fn);
}

/**
 * One middleware for the whole `/api/agentv3` surface. Registered BEFORE the routes so every handler,
 * however deep its awaits go, runs inside the zone. It decides nothing and can fail nothing — a
 * classification error only mislabels a count.
 */
export function sandboxReasonMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ reason: reasonForPath(req.path) }, next);
}
