import type { Express, Request, Response } from 'express';
import { inAiSpendZone } from '../lib/aiSpendZone';
import { callProfessionalAI } from '../lib/professionalRouting';
import { workspaceRateLimiter, verifyFirebaseToken, verifyFirebaseIdentity } from '../lib/authMiddleware';
import { gateToolAction, burnToolAction, chargeToolAction } from '../tools/toolGate';
import { loadWorkspaceFiles, listUserWorkspaceApps } from '../AgentV3/WorkspaceFileStore';
import { scanFilesStatic } from '../lib/appStaticScan';
import { scanAppGraph } from '../lib/appGraphScan';
import {
  selectFilesForAI, buildAppDebugSystemPrompt, buildAppDebugBatchPrompt,
  parseAiFindings, mergeFindings, summarizeScan,
  type AppFinding,
} from '../lib/appDebugAnalysis';
import {
  buildDebugSystemPrompt, buildDebugUserPrompt, parseDebugResponse,
} from '../lib/debugAnalysis';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';

/**
 * Full-App Debugger — the REAL whole-codebase scan route (admin request 2026-07-24).
 *
 *   GET  /api/app-debug/sources
 *     → { proV5Apps: [{ workspaceId, label, fileCount, savedAt }] }   (the user's Pro v5-built apps;
 *        GitHub repos are listed client-side from the already-connected account)
 *
 *   POST /api/app-debug/run   (NDJSON stream)
 *     body: { source: 'workspace', workspaceId }      → server loads the app's durable files, OR
 *            { source: 'github', files: {path:content} } → client-fetched repo files
 *     streams: {type:'meta'|'progress'|'findings'|'note'|'done'|'error', …}
 *
 * The scan runs TWO layers and merges them: a deterministic static scan over EVERY file (precise,
 * hallucination-free) + a budget-bounded FREE-tier AI semantic pass over the prioritised source files.
 * Findings are ranked most-severe first. Honest throughout: the AI-pass truncation for a large app is
 * reported, an unavailable AI pass degrades to static-only with a clear note (never a fake result), and
 * nothing streamed to the user names any underlying model/vendor (white-label).
 */

const BATCH_TIMEOUT_MS = 60_000;
const OVERALL_BUDGET_MS = 4 * 60_000;
/** Hard cap on a client-supplied GitHub file map (the fetch route already caps ~200 files). */
const MAX_GITHUB_FILES = 500;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

// Ownership is decided by the shared policy module, never re-typed here (audit finding #2). This
// route needs the STRICTEST rule: debugging an app requires a real, verified owner, and an anon
// workspace has none.
const ownsWorkspace = (uid: string | null, workspaceId: string): boolean => ownedByVerifiedUid(uid, workspaceId);

/** A short, human-friendly label for a Pro v5 app (no provider names; date + size only). */
function appLabel(savedAt: number, fileCount: number): string {
  const when = savedAt > 0 ? new Date(savedAt).toISOString().slice(0, 10) : 'earlier';
  return `NavBharatAI Pro app · ${fileCount} file${fileCount === 1 ? '' : 's'} · saved ${when}`;
}

function validFileMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_GITHUB_FILES) return false;
  let bytes = 0;
  for (const [k, val] of entries) {
    if (typeof k !== 'string' || typeof val !== 'string') return false;
    bytes += val.length;
    if (bytes > MAX_TOTAL_BYTES) return false;
  }
  return true;
}

export function registerAppDebugRoutes(app: Express): void {
  // ── List the user's Pro v5-built apps as debug sources ──────────────────────────────────────────
  app.get('/api/app-debug/sources', workspaceRateLimiter(), async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) {
        res.status(401).json({ error: 'Please sign in to list your NavBharatAI Pro apps.' });
        return;
      }
      const apps = await listUserWorkspaceApps(uid);
      res.json({
        proV5Apps: apps.map((a) => ({
          workspaceId: a.workspaceId,
          label: appLabel(a.savedAt, a.fileCount),
          fileCount: a.fileCount,
          savedAt: a.savedAt,
        })),
      });
    } catch {
      res.status(503).json({ error: 'NavBharatAI is briefly busy — please try again in a minute.' });
    }
  });

  // ── Run a whole-app scan (NDJSON stream) ────────────────────────────────────────────────────────
  app.post('/api/app-debug/run', workspaceRateLimiter(), inAiSpendZone(async (req: Request, res: Response) => {
    // Daily allowance / Professional Pass (flag-off = no-op). Checked BEFORE anything is loaded or
    // streamed, so a blocked caller gets a clean JSON paywall rather than a half-open stream.
    const identity = await verifyFirebaseIdentity(req);
    const gate = await gateToolAction(identity?.uid || null, identity?.email || null, 'ai_tool');
    if (!gate.allow) {
      res.status(gate.status).json(gate.body);
      return;
    }
    const uid = identity?.uid || null;
    const source = req.body?.source;

    // Resolve the file map from the chosen source (validate BEFORE we start streaming).
    let files: Record<string, string> = {};
    let sourceLabel = '';
    if (source === 'workspace') {
      const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
      if (!ownsWorkspace(uid, workspaceId)) {
        res.status(403).json({ error: 'You can only debug your own NavBharatAI Pro apps. Please sign in and try again.' });
        return;
      }
      files = await loadWorkspaceFiles(workspaceId);
      sourceLabel = 'your NavBharatAI Pro app';
      if (!files || Object.keys(files).length === 0) {
        res.status(404).json({ error: 'This app has no saved files yet — build it with NavBharatAI Pro first, then run the debugger.' });
        return;
      }
    } else if (source === 'github') {
      if (!validFileMap(req.body?.files)) {
        res.status(400).json({ error: 'No readable repository files were provided, or the repository is too large to scan.' });
        return;
      }
      files = req.body.files;
      sourceLabel = 'your GitHub repository';
    } else {
      res.status(400).json({ error: 'Choose a source to debug: a NavBharatAI Pro app or a GitHub repository.' });
      return;
    }

    // Begin the NDJSON stream.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (evt: Record<string, unknown>): void => {
      if (!closed) { try { res.write(JSON.stringify(evt) + '\n'); } catch { /* client gone */ } }
    };

    const startedAt = Date.now();
    try {
      // Layer 1 — deterministic static scan over EVERY file (fast, precise, always real).
      const staticFindings = scanFilesStatic(files);

      // Layer 2 — cross-file module-GRAPH scan (missing deps, broken imports, dead code). The
      // whole-graph checks only fire on a COMPLETE fileset (a Pro v5 app's durable store); a GitHub
      // fetch is capped at ~200 files, so its map may be partial → only the dependency check runs.
      const completeFileset = source === 'workspace';
      const graphFindings = scanAppGraph(files, completeFileset);

      // Layer 3 — plan the AI semantic pass (prioritised, budget-bounded).
      const selection = selectFilesForAI(files);
      const filesTotal = Object.keys(files).length;
      send({
        type: 'meta',
        source: sourceLabel,
        filesTotal,
        filesStaticScanned: filesTotal,
        filesAiToScan: selection.picked.length,
        filesAiSkippedForBudget: selection.skippedForBudget,
      });
      // Surface the deterministic findings immediately so the user sees real results while the AI runs.
      if (staticFindings.length) send({ type: 'findings', phase: 'static', findings: staticFindings });
      if (graphFindings.length) send({ type: 'findings', phase: 'graph', findings: graphFindings });

      const aiFindings: AppFinding[] = [];
      let aiBatchesRun = 0;
      let aiBatchesFailed = 0;
      const totalBatches = selection.batches.length;
      const system = buildAppDebugSystemPrompt();

      for (let i = 0; i < totalBatches; i++) {
        if (closed || Date.now() - startedAt > OVERALL_BUDGET_MS) break;
        const batch = selection.batches[i];
        send({
          type: 'progress',
          batch: i + 1,
          totalBatches,
          files: batch.files.map((f) => f.path),
        });
        try {
          // Same AI engine as Professional AI (admin 2026-07-24).
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('app-debug batch timeout')), BATCH_TIMEOUT_MS));
          const content = await Promise.race([
            callProfessionalAI(system, buildAppDebugBatchPrompt(batch), 'free'),
            timeout,
          ]);
          const parsed = parseAiFindings(content, batch.files.map((f) => f.path));
          aiBatchesRun++;
          if (parsed.length) {
            aiFindings.push(...parsed);
            send({ type: 'findings', phase: 'ai', findings: parsed });
          }
        } catch {
          aiBatchesFailed++;
          // Honest, white-label note — never a fabricated finding for a failed batch.
          send({ type: 'note', message: 'One part of the deep scan was busy and was skipped — the rest of the scan continued.' });
        }
      }

      // Merge + rank (deterministic static + graph win at a shared spot), then the authoritative summary.
      const merged = mergeFindings([...staticFindings, ...graphFindings], aiFindings);
      const aiUnavailable = totalBatches > 0 && aiBatchesRun === 0;
      const summary = summarizeScan(merged, {
        filesTotal,
        filesStaticScanned: filesTotal,
        filesAiScanned: aiUnavailable ? 0 : selection.picked.length,
        filesAiSkippedForBudget: selection.skippedForBudget,
        bytesAiScanned: selection.bytesAiScanned,
      });
      send({
        type: 'done',
        summary,
        findings: merged,
        aiUnavailable,
        aiBatchesFailed,
        // Honest degraded note when the deep pass could not run at all.
        note: aiUnavailable
          ? 'The deep AI pass was briefly unavailable, so this scan shows the verified static findings only. Try again shortly for the full deep analysis.'
          : undefined,
      });
      // A completed scan spends one allowance. A scan that errored below never does.
      if (gate.countsAgainstFree) burnToolAction(gate.uid, 'ai_tool');
      chargeToolAction(gate); // ONE WALLET — a batched scan bills ALL its model calls, not one
      res.end();
    } catch {
      // Stream already started → emit an honest error event and close (no fake result).
      send({ type: 'error', message: 'NavBharatAI hit a brief hiccup while scanning. Please try again in a minute.' });
      try { res.end(); } catch { /* already closed */ }
    }
  }));

  // ── Deep-dive: investigate ONE finding → root cause + full fix (interactive) ────────────────────
  app.post('/api/app-debug/investigate', workspaceRateLimiter(), inAiSpendZone(async (req: Request, res: Response) => {
    const investigateIdentity = await verifyFirebaseIdentity(req);
    const investigateGate = await gateToolAction(investigateIdentity?.uid || null, investigateIdentity?.email || null, 'ai_tool');
    if (!investigateGate.allow) {
      res.status(investigateGate.status).json(investigateGate.body);
      return;
    }
    const problem = typeof req.body?.problem === 'string' ? req.body.problem.trim() : '';
    const file = typeof req.body?.file === 'string' ? req.body.file : '';
    if (!problem) {
      res.status(400).json({ error: 'A problem to investigate is required.' });
      return;
    }

    // Resolve the file's real content: from the durable workspace (owner-gated) or the client payload.
    let code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 60_000) : '';
    if (req.body?.source === 'workspace') {
      const uid = await verifyFirebaseToken(req);
      const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
      if (!ownsWorkspace(uid, workspaceId)) {
        res.status(403).json({ error: 'You can only investigate your own NavBharatAI Pro apps.' });
        return;
      }
      const files = await loadWorkspaceFiles(workspaceId);
      if (file && typeof files[file] === 'string') code = files[file].slice(0, 60_000);
    }

    try {
      const line = Number(req.body?.line);
      const context = `File: ${file || '(unknown)'}${Number.isInteger(line) && line > 0 ? ` (around line ${line})` : ''}\n\n${code}`;
      // Same AI engine as Professional AI (admin 2026-07-24).
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('investigate timeout')), 60_000));
      const content = await Promise.race([
        callProfessionalAI(buildDebugSystemPrompt(), buildDebugUserPrompt(problem, context, 'Full-app finding'), 'free'),
        timeout,
      ]);
      if (!content.trim()) {
        res.status(502).json({ error: 'The analysis came back empty — please try again.' });
        return;
      }
      // Only a genuinely-answered investigation spends an allowance.
      if (investigateGate.countsAgainstFree) burnToolAction(investigateGate.uid, 'ai_tool');
      chargeToolAction(investigateGate); // ONE WALLET
      res.json(parseDebugResponse(content));
    } catch {
      res.status(503).json({ error: 'NavBharatAI\'s engine is briefly busy — please try again in a minute.' });
    }
  }));
}
