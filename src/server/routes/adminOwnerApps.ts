import type { Response } from 'express';
import type { UserWorkspaceApp, UserWorkspaceAppsResult } from '../AgentV3/WorkspaceFileStore';
import { sliceOwnerPage, type BuiltAppRow } from '../AgentV3/adminBuiltApps';

/** The owner branch of the authenticated admin apps route. Keep unavailable, empty and bounded
 * reads distinct through the response; callers must not infer a person's history from an outage. */
export async function sendAdminOwnerApps(
  res: Pick<Response, 'status' | 'json'>, uid: string, cursor: string, limit: number,
  deps: {
    read: (uid: string, limit: number) => Promise<UserWorkspaceAppsResult>;
    rows: (page: UserWorkspaceApp[]) => Promise<BuiltAppRow[]>;
  },
): Promise<void> {
  try {
    const result = await deps.read(uid, 200);
    if (!result.ok) {
      res.status(502).json({ ok: false, error: 'Could not read this user’s saved apps.' });
      return;
    }
    const { page, nextOffset } = sliceOwnerPage(result.apps, cursor, limit);
    res.json({ ok: true, mode: 'owner', rows: await deps.rows(page), nextCursor: nextOffset,
      pageSize: limit, scanLimited: result.scanLimited });
  } catch {
    res.status(502).json({ ok: false, error: 'Could not read this user’s saved apps.' });
  }
}
