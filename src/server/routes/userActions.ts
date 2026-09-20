import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { verifiedWorkspaceReadOk } from '../lib/workspaceIdentity';
import { loadUserSecretNamesFor } from '../lib/secrets';
import {
  closeUserAction, loadUserActions,
} from '../AgentV3/UserActionStore';
import {
  badgeCount, shouldAutoOpen, verifyAgainstVault,
  type UserAction,
} from '../AgentV3/userActions';

/**
 * WHAT THE USER MUST DO — the two doors the tray uses (admin 2026-09-20).
 *
 *   GET  /api/agentv3/user-actions?workspaceId=…   — the list, plus the badge count
 *   POST /api/agentv3/user-actions/close           — "I did it" / "I don't want this"
 *
 * Deliberately NOT added to `routes/agentv3.ts`. That file is nineteen thousand lines and several
 * sessions edit it at once; a new surface that needs none of its machinery belongs beside it, not
 * inside it.
 *
 * 🔒 AUTH IS OWNERSHIP OF THE WORKSPACE, not possession of its id. The caller names a workspace and
 * the server checks the VERIFIED uid owns it, through the same `verifiedWorkspaceReadOk` policy the
 * private build report already uses — so learning somebody's workspace id does not reveal which
 * credentials their app is waiting for, which is exactly what this list would otherwise leak.
 */

/** Statuses a USER may set. 'superseded' is the engine's own word and is not accepted from a client. */
export type UserSettableStatus = 'done' | 'not_needed';
const USER_SETTABLE: readonly UserSettableStatus[] = ['done', 'not_needed'];

function userSettable(value: unknown): value is UserSettableStatus {
  return typeof value === 'string' && (USER_SETTABLE as readonly string[]).includes(value);
}

export interface UserActionsPayload {
  actions: UserAction[];
  open: number;
  autoOpen: boolean;
}

/**
 * THE SELF-CLOSING HALF, at the moment of reading (precision rule 3).
 *
 * A credential the user has since saved — through this tray, through Settings, or during an earlier
 * build — is not a task, and must not be counted by the badge. The names come from the SAME scoped
 * vault read the build itself uses to write `.env`, so "verified" means precisely "the build would
 * find this key", rather than a second, looser definition that could disagree with it.
 */
export async function resolveUserActions(
  workspaceId: string,
  userId: string,
  now: number = Date.now(),
): Promise<UserActionsPayload> {
  const stored = await loadUserActions(workspaceId);
  const names = await loadUserSecretNamesFor(userId, workspaceId).catch(() => [] as string[]);
  const verified = verifyAgainstVault(stored, names, now);
  // Persist only what actually changed, so a poll costs no writes on the ordinary path.
  const closedNow = verified.filter((a, i) => a.status !== stored[i]?.status);
  await Promise.all(closedNow.map((a) => closeUserAction(workspaceId, a.id, 'done', 'verified', now).catch(() => false)));
  return { actions: verified, open: badgeCount(verified), autoOpen: shouldAutoOpen(verified) };
}

export function registerUserActionRoutes(app: Express): void {
  app.get('/api/agentv3/user-actions', async (req: Request, res: Response) => {
    const workspaceId = typeof req.query?.workspaceId === 'string' ? req.query.workspaceId : '';
    const uid = await verifyFirebaseToken(req);
    if (!verifiedWorkspaceReadOk(uid, workspaceId)) {
      res.status(403).json({ error: 'That workspace is not yours.' });
      return;
    }
    try {
      res.json(await resolveUserActions(workspaceId, uid ?? ''));
    } catch {
      // An empty list is the honest answer to "we could not read it" here: the tray then shows no
      // badge, which is the same as having nothing to do — never an invented task.
      res.json({ actions: [], open: 0, autoOpen: false });
    }
  });

  app.post('/api/agentv3/user-actions/close', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { workspaceId?: unknown; id?: unknown; status?: unknown };
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const id = typeof body.id === 'string' ? body.id : '';
    const status = body.status;
    const uid = await verifyFirebaseToken(req);
    if (!verifiedWorkspaceReadOk(uid, workspaceId)) {
      res.status(403).json({ error: 'That workspace is not yours.' });
      return;
    }
    if (!id || !userSettable(status)) {
      res.status(400).json({ error: 'Unknown action.' });
      return;
    }
    // `closedBy: 'user'` — their word, not a measurement, and the tray says so. Only this kind of
    // close can ever be re-opened by a later build that still needs the thing.
    const ok = await closeUserAction(workspaceId, id, status, 'user');
    if (!ok) { res.status(404).json({ error: 'That item is no longer there.' }); return; }
    res.json(await resolveUserActions(workspaceId, uid ?? ''));
  });
}
