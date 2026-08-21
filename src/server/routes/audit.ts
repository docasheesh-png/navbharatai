import type { Express, Request, Response } from 'express';
import { callGemini } from '../lib/aiCalls';
import { getSecurityContext } from '../lib/prompts';
import { sendSafeError } from '../lib/httpError';
import { SCAN_STAGES, secretFindings, configFindings, countFindings, scanVerdict, type ScanFinding } from '../lib/securityScan';

/**
 * Security-scan + website-audit routes.
 *
 * POST /api/security/scan — a security scan that STREAMS its real stages.
 *
 * ADMIN 2026-08-21: "SecurityScan ka progress bar abhi bhi nakli hai — isko asli bana do."
 *
 * This route used to be a single AI call. The screen in front of it walked five invented phase names
 * on a timer ("Phase 3: Static Analysis (SAST) Patterns…") and pushed a bar to 95% — naming checks
 * that were never performed. The bar is now driven by this route: each stage below is real work, and
 * a progress event is emitted only when that stage has genuinely finished.
 *
 * WHY NEWLINE-DELIMITED JSON RATHER THAN SSE: the client is our own single consumer, the events are
 * few and one-directional, and NDJSON needs no protocol layer on either side — `res.write(JSON + \n)`
 * here, a stream reader there. An SSE dependency would be machinery around three messages.
 *
 * ⚠️ A STAGE THAT FAILS IS REPORTED AS FAILED, not skipped silently. The two deterministic stages
 * cannot realistically fail; the AI review genuinely can (no key, provider down), and when it does the
 * user is told the review did not run — with the deterministic findings still shown, because those are
 * real and already earned. "No issues found" from a scan that quietly skipped its last stage is the
 * exact lie this change removes.
 */
export function registerAuditRoutes(app: Express): void {
  app.post('/api/security/scan', async (req: Request, res: Response) => {
    const { target, files } = req.body ?? {};
    const geminiKey = req.headers['x-gemini-key'] as string | undefined;

    if (!target) return res.status(400).json({ error: 'Target is required' });

    const fileMap: Record<string, string> = files && typeof files === 'object' ? files : {};

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no'); // proxies must not hold the stages back

    const send = (event: Record<string, unknown>) => {
      try { res.write(`${JSON.stringify(event)}\n`); } catch { /* client left — the loop below stops */ }
    };

    const findings: ScanFinding[] = [];
    let stagesDone = 0;

    send({ type: 'start', stages: SCAN_STAGES.map((s) => ({ id: s.id, label: s.label })) });

    try {
      // ── Stage 1: deterministic secret / unsafe-code scan (real, free, instant) ──
      const secrets = secretFindings(fileMap);
      findings.push(...secrets);
      stagesDone++;
      send({ type: 'stage', id: 'secrets', ok: true, found: secrets.length, done: stagesDone, total: SCAN_STAGES.length });

      // ── Stage 2: deterministic configuration checks ──
      const config = configFindings(fileMap);
      findings.push(...config);
      stagesDone++;
      send({ type: 'stage', id: 'config', ok: true, found: config.length, done: stagesDone, total: SCAN_STAGES.length });

      // ── Stage 3: the AI review (the only part that was ever real, now honest about failing) ──
      let reply = '';
      let reviewOk = true;
      let reviewError = '';
      try {
        const prompt = `Perform a deep security scan on the following target: ${target}.
Current Project Files (if applicable): ${JSON.stringify(fileMap)}
Analyze the target for any vulnerabilities, configuration issues, or exposed secrets.

The following issues were ALREADY found by a deterministic scanner — do not repeat them, and do not
contradict them. Add only what a reading of the code can add beyond this list:
${findings.length ? findings.map((f) => `- ${f.file}:${f.line} — ${f.problem}`).join('\n') : '(none)'}`;
        reply = await callGemini(prompt, geminiKey, [], getSecurityContext(target));
      } catch (err) {
        reviewOk = false;
        reviewError = err instanceof Error ? err.message : 'The security review could not run.';
      }
      if (reviewOk) stagesDone++;
      send({
        type: 'stage', id: 'review', ok: reviewOk, done: stagesDone, total: SCAN_STAGES.length,
        ...(reviewOk ? {} : { error: reviewError }),
      });

      const counts = countFindings(findings);
      send({
        type: 'done',
        findings,
        counts,
        verdict: scanVerdict(counts, stagesDone, SCAN_STAGES.length),
        reply: reviewOk ? reply : '',
        reviewOk,
        ...(reviewOk ? {} : { reviewError }),
      });
      res.end();
    } catch (error: unknown) {
      // The stream has already started, so a status code is no longer available to us — the failure
      // travels as the last event instead of the connection simply going quiet.
      console.error('Security scan failure:', error instanceof Error ? error.message : error);
      send({ type: 'failed', error: 'The security scan could not be completed. Please try again.' });
      res.end();
    }
  });

  // REAL WEBSITE AUDIT ENGINE ENDPOINT
  app.post('/api/audit/full', async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
      // const report = await fullWebsiteAudit(url);
      const report = { status: 'audit_not_available' }; // Placeholder
      res.json(report);
    } catch (error: any) {
      sendSafeError(res, 500, 'Website audit failed. Please try again.', error, 'website audit');
    }
  });
}
