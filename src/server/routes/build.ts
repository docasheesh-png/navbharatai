import type { Express, Request, Response } from 'express';
import { requireUserMatch, verifyFirebaseToken } from '../lib/authMiddleware';

import { APP_KNOWLEDGE_BASE } from '../AppContext/AppKnowledgeBase';
import { proBuildSessionStore } from '../pro/ProBuildSession';
import { buildHistoryStore } from '../project/BuildHistoryStore';
import { listUserWorkspaceApps, countWorkspaceFiles, loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { mayTouchBuildHistory, refusalStatus, refusalMessage } from '../lib/buildHistoryAccess';
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
  // 🔒 DELETED 2026-10-11 (Q-162, decided when this file was next touched — by Q-128). They were kept as a
  // 410 for "an old script, a stale bookmark", but nothing named such a caller, and no bundled phone app can
  // hold one: the last client call was gone before the first Play production release. A route with no
  // caller is decided, not kept: so they are gone, and an unknown route answers like any other.

  // G1.2 — Refresh-safe build recovery. Client calls this on mount to restore
  // the last completed build for a sessionId without re-running the build.
  //
  // 🔒 THE SAME HOLE AS Q-780, ON THE ROUTE Q-780 MISSED (production-hardening pass, 2026-10-19). This
  // returns the app's whole `files` map — the user's source code — and it had NO authentication: the
  // session id was treated as a capability, but `App.tsx` mints it as `pro-${Date.now()}`, a guessable
  // millisecond timestamp. The three build-history routes below were closed with mayTouchBuildHistory;
  // this read now passes the same rule, with the same refusals (which do not reveal whether a session
  // exists). The store has had no writer since the legacy engine was retired, so what it still holds
  // is old builds — exactly the data nobody is watching.
  app.get('/api/build-session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = routeParams(req.params);
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      const access = await mayTouchBuildHistory(await verifyFirebaseToken(req), sessionId, countWorkspaceFiles);
      if (!access.allowed) return res.status(refusalStatus(access.reason)).json({ error: refusalMessage(access.reason) });
      // Legacy bare records have no persisted owner. Never fall back to them: a second account can
      // create its own workspace with the same session id. Existing records are retained for review.
      const session = await proBuildSessionStore.load(access.workspaceId);
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
      // 🔒 Q-780: this was open to anyone who could name a session id, and for a signed-in web user
      // that id is `pro-${Date.now()}`. See buildHistoryAccess.ts for the whole rule, including why
      // `agentv3-anon-…` keeps its documented capability model.
      const access = await mayTouchBuildHistory(await verifyFirebaseToken(req), sessionId, countWorkspaceFiles);
      if (!access.allowed) return res.status(refusalStatus(access.reason)).json({ error: refusalMessage(access.reason) });
      const versions = await buildHistoryStore.list(access.workspaceId);
      // This notice is the same for every empty owner history and never probes a global legacy id.
      // It explains the security migration without revealing whether somebody else's old rows exist.
      return res.json({ versions, ...(versions.length === 0 && access.as === 'owner' ? {
        historyNotice: 'Restore points saved before the security update require account ownership verification before they can be opened. Your current app is unchanged.',
      } : {}) });
    } catch {
      return res.status(500).json({ error: 'failed to load history' });
    }
  });

  // Phase 2.1 — Fetch a specific version's full file snapshot for restore.
  app.get('/api/build-history/:sessionId/:versionId', async (req: Request, res: Response) => {
    try {
      const { sessionId, versionId } = routeParams(req.params);
      if (!sessionId || !versionId) return res.status(400).json({ error: 'sessionId and versionId required' });
      // 🔒 Q-780 — and this is the route that matters most: it returns the app's whole `files` map,
      // i.e. the user's source code.
      const access = await mayTouchBuildHistory(await verifyFirebaseToken(req), sessionId, countWorkspaceFiles);
      if (!access.allowed) return res.status(refusalStatus(access.reason)).json({ error: refusalMessage(access.reason) });
      const version = await buildHistoryStore.get(access.workspaceId, versionId);
      if (!version) return res.status(404).json({ error: 'version not found' });
      return res.json(version);
    } catch {
      return res.status(500).json({ error: 'failed to load version' });
    }
  });

  // Code Versioning — save a MANUAL named restore-point (checkpoint) to the SAME durable, cross-device
  // build-history store (admin 2026-07-24). This makes the Versioning tool genuinely strong: alongside
  // the automatic per-build checkpoints, a user can snapshot "this is good" before a risky change and
  // Restore to it later from any device. Bounded + best-effort.
  //
  // 🔴 THIS COMMENT USED TO SAY "the sessionId is the unguessable capability, mirroring the GET routes
  // above" (corrected Q-780). It is not unguessable: `App.tsx` mints it as `pro-${Date.now()}`. All
  // three routes now check ownership — see buildHistoryAccess.ts.
  app.post('/api/build-history/:sessionId/checkpoint', async (req: Request, res: Response) => {
    try {
      const { sessionId } = routeParams(req.params);
      const body = req.body as { name?: unknown; files?: unknown; fromWorkspace?: unknown };
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      // 🔒 Q-780: unauthenticated, this let anyone who guessed a session id WRITE a version into
      // somebody else's Time Machine.
      const access = await mayTouchBuildHistory(await verifyFirebaseToken(req), sessionId, countWorkspaceFiles);
      if (!access.allowed) return res.status(refusalStatus(access.reason)).json({ error: refusalMessage(access.reason) });
      // 🔒 THE APP'S OWN SAVED FILES, NOT A SCREEN'S COPY (Q-128). `fromWorkspace` saves the files the app
      // really holds — what the next build reads. A screen's copy can be stale or belong to the app the user
      // was on before switching, and a version named "this app" must be this app. `files` stays for callers
      // that send their own (an older bundled phone app).
      const source = body?.fromWorkspace === true
        ? await loadWorkspaceFiles(access.workspaceId).catch(() => ({} as Record<string, string>))
        : body?.files;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return res.status(400).json({ error: 'files map required' });
      }
      const files: Record<string, string> = {};
      let bytes = 0;
      for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
        if (typeof k !== 'string' || typeof v !== 'string') continue;
        bytes += k.length + v.length;
        if (bytes > 5 * 1024 * 1024) break; // hard cap; the store caps again to the Firestore 1MB doc limit
        files[k] = v;
      }
      if (Object.keys(files).length === 0) return res.status(400).json({ error: 'no readable files to checkpoint' });
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Manual checkpoint';
      await buildHistoryStore.save(access.workspaceId, {
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
