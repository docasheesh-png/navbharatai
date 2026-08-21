// User reports — one way in for the person, one way out for the admin.
//
// ADMIN 2026-08-21: "user pure app navbharatai me kahi bhi kuch bhi report kar sakta hai … admin
// pannel me ek alag page banao, yaha admin sabhi report read kar sakta hai … dono profile dekh sake."
//
// WHAT WAS THERE BEFORE, and why this replaces rather than joins it: the App Mart player had a report
// button that wrote to Firestore and that NOTHING EVER READ. No admin route, no screen. The user was
// told a person reviews every report; no person could. A second half-system beside it would have made
// that worse, so the write and the read ship together here.
//
// 🔒 THE ONE RULE THAT MATTERS FOR SAFETY: a reporter may say WHAT is wrong, never WHO it belongs to.
// The uid a report is filed against is resolved on the SERVER from the app id. If the client could
// name the accused, anyone could aim a pile of complaints at a competitor and get them looked at.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { requireAdmin } from '../lib/adminAuth';
import { rateLimiter } from '../lib/authMiddleware';
import { validateReport, type ReportContext } from '../../lib/userReport';
import {
  buildReport, saveReport, listReports, getReport, getReportScreenshot, setReportStatus,
  countReportsAgainst,
} from '../lib/userReportStore';
import { getWebApp } from '../lib/navStoreWeb';
import { resolveUserIdentities } from '../lib/adminUserLookup';
import { getServerDb } from '../lib/serverDb';

/** The Firestore handle the identity lookup needs, or null so it degrades to ids rather than throwing. */
function identityDb() {
  try {
    return getServerDb() as never;
  } catch {
    return null;
  }
}

/** Trim whatever the client sent about its own context — none of it is trusted, all of it is capped. */
function readContext(raw: unknown): ReportContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  return {
    view: s(o.view, 60),
    build: s(o.build, 40),
    platform: s(o.platform, 20),
    userAgent: s(o.userAgent, 300),
  };
}

export function registerReportRoutes(app: Express): void {
  /**
   * File a report. Sign-in required — an anonymous complaint cannot be followed up, and a report
   * nobody can be asked about is worth very little to the person being complained about either.
   */
  app.post(
    '/api/report',
    // A report costs nothing to send and everything to ignore, so the limit is generous — it exists to
    // stop a script filling the admin's queue, not to ration a user with a real problem.
    rateLimiter({ name: 'report', authed: 30, anon: 5, noun: 'reports' }),
    async (req: Request, res: Response) => {
      const me = await verifyFirebaseIdentity(req);
      if (!me?.uid) return res.status(401).json({ error: 'Sign in to send a report.' });

      const parsed = validateReport({
        message: req.body?.message,
        targetKind: req.body?.targetKind,
        targetId: req.body?.targetId,
        screenshot: req.body?.screenshot,
      });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });

      // WHO this is about is decided HERE, never by the sender. For an app we look up its real owner;
      // for a user report the named uid is the subject, and an admin sees who filed it either way.
      let ownerUid: string | undefined;
      if (parsed.kind === 'app' && parsed.targetId) {
        try {
          const found = await getWebApp(parsed.targetId);
          if (!found) return res.status(404).json({ error: 'That app is not on the store.' });
          ownerUid = found.uid;
        } catch {
          return res.status(502).json({ error: 'Could not check that app just now. Please try again.' });
        }
      } else if (parsed.kind === 'user' && parsed.targetId) {
        ownerUid = parsed.targetId;
      }

      const report = buildReport({
        reporterUid: me.uid,
        target: { kind: parsed.kind, ...(parsed.targetId ? { id: parsed.targetId } : {}), ...(ownerUid ? { ownerUid } : {}) },
        message: parsed.message,
        hasScreenshot: !!parsed.screenshot,
        context: readContext(req.body?.context),
      });

      try {
        await saveReport(report, parsed.screenshot);
        res.json({ ok: true, id: report.id });
      } catch {
        // Honest: the user pressed send and it did not save. Never a silent success.
        res.status(502).json({ error: 'Could not send your report. Please try again in a moment.' });
      }
    },
  );

  // ── Admin ─────────────────────────────────────────────────────────────────

  /** Every report, newest first. `?status=open` narrows it. */
  app.get('/api/admin/reports', requireAdmin, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = await listReports({
      status: status === 'open' || status === 'reviewed' || status === 'actioned' || status === 'dismissed' ? status : undefined,
      limit: Math.max(1, Math.min(200, Number(req.query.limit) || 100)),
    });

    // BOTH PEOPLE, NAMED. A list of uids is not something an admin can act on — that lesson is already
    // written into adminUserLookup, and this is the screen that needs it most.
    const uids = [...new Set(rows.flatMap((r) => [r.reporterUid, r.target.ownerUid].filter(Boolean) as string[]))];
    const people = await resolveUserIdentities(uids, identityDb());
    res.json({
      reports: rows.map((r) => ({
        ...r,
        reporter: people.get(r.reporterUid) ?? null,
        reported: r.target.ownerUid ? people.get(r.target.ownerUid) ?? null : null,
      })),
    });
  });

  /** One report, with its screenshot and how many other reports name the same person. */
  app.get('/api/admin/reports/:id', requireAdmin, async (req: Request, res: Response) => {
    const report = await getReport(String(req.params.id || ''));
    if (!report) return res.status(404).json({ error: 'No such report.' });
    const [screenshot, people, againstCount] = await Promise.all([
      report.hasScreenshot ? getReportScreenshot(report.id) : Promise.resolve(null),
      resolveUserIdentities([report.reporterUid, report.target.ownerUid].filter(Boolean) as string[], identityDb()),
      report.target.ownerUid ? countReportsAgainst(report.target.ownerUid) : Promise.resolve(0),
    ]);
    res.json({
      report,
      reporter: people.get(report.reporterUid) ?? null,
      reported: report.target.ownerUid ? people.get(report.target.ownerUid) ?? null : null,
      // A single complaint and a tenth complaint about the same account are different situations, and
      // the admin should not have to count rows by hand to tell them apart.
      reportsAgainstReported: againstCount,
      screenshot,
    });
  });

  /** Mark a report handled, with the admin's own note kept as the record of the decision. */
  app.post('/api/admin/reports/:id/status', requireAdmin, async (req: Request, res: Response) => {
    const status = String(req.body?.status || '');
    if (!['open', 'reviewed', 'actioned', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Unknown status.' });
    }
    const ok = await setReportStatus(
      String(req.params.id || ''),
      status as 'open' | 'reviewed' | 'actioned' | 'dismissed',
      typeof req.body?.note === 'string' ? req.body.note : undefined,
    );
    if (!ok) return res.status(502).json({ error: 'Could not update that report.' });
    res.json({ ok: true, status });
  });
}
