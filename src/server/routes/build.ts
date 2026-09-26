import type { Express, Request, Response } from 'express';
import { requireUserMatch, verifyFirebaseToken } from '../lib/authMiddleware';

import { APP_KNOWLEDGE_BASE } from '../AppContext/AppKnowledgeBase';
import { proBuildSessionStore } from '../pro/ProBuildSession';
import { buildHistoryStore } from '../project/BuildHistoryStore';
import { listUserWorkspaceApps } from '../AgentV3/WorkspaceFileStore';
import { userCostStore } from '../lib/UserCostStore';
import { workspacePrefixFor } from '../lib/workspaceIdentity';
import { routeParams } from '../lib/expressCompat';

export function registerBuildRoutes(app: Express): void {
  // G1.3 — Capability registry endpoint. Returns the full AppKnowledgeBase so AI
  // assistants and tooling can programmatically discover what NavBharatAI can do.
  // Public (no auth) — it's a feature list, not private data.
  app.get('/api/capabilities', (_req: Request, res: Response) => {
    res.json({ version: 1, features: APP_KNOWLEDGE_BASE });
  });

  // ── GUIDER (RETIRED) — two permanent no-ops, and the dead code below them is now gone.
  //
  // These were unauthenticated endpoints that, when a caller passed `agentic:true`, ran an LLM call on
  // NavBharatAI's OWN provider budget — a money-bleed surface, sibling of the retired /api/pro-* routes.
  // The SEC Phase 5 re-audit neutralised them by putting an early `return` at the top of each handler.
  //
  // WHY THE BODIES ARE DELETED RATHER THAN LEFT BEHIND THE RETURN. What sat under those returns was
  // ~40 lines of unreachable code that still CONSTRUCTED the paid model call. Unreachable is not the
  // same as harmless: it reads as a working feature that someone merely switched off, so the obvious
  // "cleanup" — deleting the stray early return — silently re-arms the exact money bleed the audit
  // closed. A guard whose removal looks like tidying is not a guard. If this capability is ever wanted
  // again it comes back through v5.0's authenticated, billed path, not by reviving this.
  //
  // The old comments claimed "the frontend calls this BEFORE a build" and "the frontend uses this AFTER
  // a build". Neither was true — v5.0 superseded both and no client has called either for months.
  //
  // KEPT AS 200 NO-OPS RATHER THAN DELETED OUTRIGHT, deliberately: the Android app ships BUNDLED, so an
  // old installed copy runs its own frozen frontend forever. A 404 would surface there as a broken
  // build; these responses are the exact "nothing to confirm" / "no grade" shapes such a client already
  // handles, so it degrades into a normal build instead of an error.
  app.post('/api/guider/plan', (_req: Request, res: Response) => {
    res.json({ confirm: false });
  });

  app.post('/api/guider/grade', (_req: Request, res: Response) => {
    res.json({ grade: null });
  });

  // ── THE LEGACY BUILD ENGINE (RETIRED 2026-09-25, admin: "jo kaam ka nahi hai, woh hata do") ──
  //
  // `POST /api/build` and `POST /api/build-stream` ran the pre-v3.0 engine (src/server/EngineerAI,
  // the project/ build pipeline, pro/ orchestrator) with a paid fallback chain on NavBharatAI's own
  // provider accounts. No client has called them since July: `buildAppStream` lost its last caller on
  // 2026-07-05 and `buildApp` on 2026-07-21 (a component that was itself unreachable), both before any
  // Play production release. Every build runs in NavBharatAI Pro (AgentV3). A reachable endpoint that
  // spends our money for a feature nobody uses is a cost surface, not a feature, so the engine is gone.
  //
  // Kept as an honest 410 rather than a bare 404, for the same reason as the guider routes above: it
  // says what happened to anybody — an old script, a stale bookmark — who still calls it.
  const retiredBuild = (_req: Request, res: Response) => {
    res.status(410).json({ error: 'This build endpoint has been retired. Apps are built in NavBharatAI Pro.' });
  };
  app.post('/api/build', retiredBuild);
  app.post('/api/build-stream', retiredBuild);

  // G1.2 — Refresh-safe build recovery. Client calls this on mount to restore
  // the last completed build for a sessionId without re-running the build.
  app.get('/api/build-session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = routeParams(req.params);
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      const session = await proBuildSessionStore.load(sessionId);
      if (!session) return res.status(404).json({ error: 'not found' });
      return res.json(session);
    } catch {
      return res.status(500).json({ error: 'failed to load session' });
    }
  });

  // Phase 2.1 — List all version checkpoints for a workspace (metadata only, no files).
  // Used by the frontend version history panel.
  app.get('/api/build-history/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = routeParams(req.params);
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      const versions = await buildHistoryStore.list(sessionId);
      return res.json({ versions });
    } catch {
      return res.status(500).json({ error: 'failed to load history' });
    }
  });

  // Phase 2.1 — Fetch a specific version's full file snapshot for restore.
  app.get('/api/build-history/:sessionId/:versionId', async (req: Request, res: Response) => {
    try {
      const { sessionId, versionId } = routeParams(req.params);
      if (!sessionId || !versionId) return res.status(400).json({ error: 'sessionId and versionId required' });
      const version = await buildHistoryStore.get(sessionId, versionId);
      if (!version) return res.status(404).json({ error: 'version not found' });
      return res.json(version);
    } catch {
      return res.status(500).json({ error: 'failed to load version' });
    }
  });

  // Code Versioning — save a MANUAL named restore-point (checkpoint) to the SAME durable, cross-device
  // build-history store (admin 2026-07-24). This makes the Versioning tool genuinely strong: alongside
  // the automatic per-build checkpoints, a user can snapshot "this is good" before a risky change and
  // Restore to it later from any device. Bounded + best-effort; the sessionId is the unguessable
  // capability, mirroring the GET routes above.
  app.post('/api/build-history/:sessionId/checkpoint', async (req: Request, res: Response) => {
    try {
      const { sessionId } = routeParams(req.params);
      const body = req.body as { name?: unknown; files?: unknown };
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      if (!body?.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
        return res.status(400).json({ error: 'files map required' });
      }
      const files: Record<string, string> = {};
      let bytes = 0;
      for (const [k, v] of Object.entries(body.files as Record<string, unknown>)) {
        if (typeof k !== 'string' || typeof v !== 'string') continue;
        bytes += k.length + v.length;
        if (bytes > 5 * 1024 * 1024) break; // hard cap; the store caps again to the Firestore 1MB doc limit
        files[k] = v;
      }
      if (Object.keys(files).length === 0) return res.status(400).json({ error: 'no readable files to checkpoint' });
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Manual checkpoint';
      await buildHistoryStore.save(sessionId, {
        commitMessage: name,
        fileCount: Object.keys(files).length,
        files,
        isEdit: true,
        tier: 'manual',
        ok: true,
      });
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'failed to save checkpoint' });
    }
  });

  // Code Versioning "Time Machine" — list the signed-in user's apps so they can pick WHICH app's
  // version history to view (admin 2026-07-24). Each Pro v5 app is `agentv3-{uid}-{sessionId}`; we
  // return the raw sessionId (the build-history key) + a friendly label. Anonymous → empty list.
  app.get('/api/versioning/apps', async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.json({ apps: [] });
      const prefix = workspacePrefixFor(uid);
      if (!prefix) { res.json({ ok: true, apps: [] }); return; }
      const apps = (await listUserWorkspaceApps(uid)).map((a) => {
        const sessionId = a.workspaceId.startsWith(prefix) ? a.workspaceId.slice(prefix.length) : a.workspaceId;
        const when = a.savedAt > 0 ? new Date(a.savedAt).toISOString().slice(0, 10) : '';
        return {
          sessionId,
          label: `App · ${a.fileCount} file${a.fileCount === 1 ? '' : 's'}${when ? ` · ${when}` : ''}`,
          fileCount: a.fileCount,
          savedAt: a.savedAt,
        };
      });
      return res.json({ apps });
    } catch {
      return res.json({ apps: [] });
    }
  });

  // Phase 4.2 — Per-user monthly AI cost summary for the Billing panel.
  // SECURITY (audit IDOR): scope to the verified token uid — this exposes a user's build count and AI
  // spend; without the check any uid could be read. Client sends the Bearer token via authedHeaders();
  // VITEST skips the check (see requireUserMatch).
  app.get('/api/user/usage/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const { userId } = routeParams(req.params);
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const doc = await userCostStore.get(userId, month);
    return res.json(doc ?? { userId, month: month ?? new Date().toISOString().slice(0, 7), totalBuilds: 0, totalCostUsd: 0, updatedAt: 0 });
  });
}
