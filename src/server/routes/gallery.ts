import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { isStoreAdmin } from './navStore';
import {
  preparePublishBundle,
  exclusionSummary,
} from '../lib/galleryPublishGate';
import {
  saveGalleryApp,
  getGalleryApp,
  updateGalleryApp,
  listGalleryApps,
  listGalleryAppsByUid,
  incrementRemixCount,
  isGalleryConfigured,
  normalizeListing,
  toPublic,
  type GalleryApp,
} from '../lib/galleryStore';

/**
 * COMMUNITY GALLERY / REMIX (ROADMAP §2).
 *
 *   POST /api/gallery/publish            — publish YOUR app's source for others to remix.
 *   GET  /api/gallery                    — browse approved apps (public).
 *   GET  /api/gallery/mine               — your own entries, whatever their state.
 *   GET  /api/gallery/:id                — one approved app's details (public).
 *   GET  /api/gallery/:id/source         — the files, for a remix (approved only).
 *   POST /api/gallery/:id/remix          — count a remix and return the files to start from.
 *   GET  /api/gallery/admin/pending      — the review queue (admin).
 *   POST /api/gallery/admin/:id/review   — approve / reject / remove (admin).
 *
 * 🔒 TWO INVARIANTS, both enforced here and neither adjustable by a request:
 *
 * 1. NOTHING IS PUBLISHED WITHOUT PASSING THE SECRET GATE. This is the only route in the codebase that
 *    makes a user's SOURCE public, and generated source sits next to their `.env` and their live keys.
 *    `preparePublishBundle` decides what travels; a real secret REFUSES the publish and names the file
 *    and line rather than being silently stripped, because "published" must mean what the user thinks.
 *
 * 2. NOTHING REACHES `approved` EXCEPT AN ADMIN SAYING SO. A clean scan yields `pending`. The scan
 *    proves no key leaked — it does not prove the code is something we want to host and hand to other
 *    users to run. Same model as the Nav App Store, deliberately, and it uses the same admin list.
 */
export function registerGalleryRoutes(app: Express): void {
  /** Publish the current app's source. Lands as `pending`; only an admin can make it public. */
  app.post('/api/gallery/publish', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!who?.uid) return res.status(401).json({ error: 'Sign in to publish your app.' });
    if (!isGalleryConfigured()) {
      return res.status(503).json({ error: 'The gallery is not accepting apps right now.' });
    }

    const listing = normalizeListing(req.body ?? {});
    if (!listing.ok) return res.status(400).json({ error: listing.message });

    const files = req.body?.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      return res.status(400).json({ error: 'Nothing to publish yet — build an app first.' });
    }

    // 🔒 The gate. Everything below only runs on a bundle it approved.
    const bundle = preparePublishBundle(files as Record<string, string>);
    if (!bundle.ok) {
      return res.status(422).json({ error: bundle.message, blockers: bundle.blockers });
    }

    const record: GalleryApp = {
      id: crypto.randomUUID(),
      uid: who.uid,
      authorEmail: who.email || '',
      authorName: String(req.body?.authorName || who.email?.split('@')[0] || 'A NavBharatAI user').slice(0, 60),
      title: listing.title,
      description: listing.description,
      tags: listing.tags,
      status: 'pending',                       // 🔒 the ONLY status this route can produce
      publishedAt: Date.now(),
      files: bundle.files,
      fileCount: Object.keys(bundle.files).length,
      bytes: bundle.bytes,
      excludedPaths: bundle.excluded.map((e) => e.path),
      remixCount: 0,
      ...(typeof req.body?.remixedFrom === 'string' ? { remixedFrom: req.body.remixedFrom } : {}),
    };

    try {
      await saveGalleryApp(record);
    } catch {
      return res.status(503).json({ error: 'Could not save your app right now. Please try again.' });
    }

    res.json({
      ok: true,
      id: record.id,
      status: record.status,
      message: 'Sent for review. It appears in the gallery once an admin approves it.',
      excluded: exclusionSummary(bundle.excluded),
    });
  });

  /** Browse the gallery. Public, and only ever `approved` records. */
  app.get('/api/gallery', async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const apps = await listGalleryApps('approved', limit);
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q
      ? apps.filter((a) => `${a.title} ${a.description} ${a.tags.join(' ')}`.toLowerCase().includes(q))
      : apps;
    res.json({ apps: filtered.map(toPublic) });
  });

  /** The publisher's own entries, including pending and rejected ones, with the reviewer's note. */
  app.get('/api/gallery/mine', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!who?.uid) return res.status(401).json({ error: 'Sign in to see your published apps.' });
    const apps = await listGalleryAppsByUid(who.uid, 50);
    res.json({
      apps: apps.map((a) => ({ ...toPublic(a), status: a.status, reviewNote: a.reviewNote })),
    });
  });

  /** One approved app. */
  app.get('/api/gallery/:id', async (req: Request, res: Response) => {
    const found = await getGalleryApp(String(req.params.id));
    if (!found || found.status !== 'approved') return res.status(404).json({ error: 'That app is not available.' });
    res.json({ app: toPublic(found), excludedPaths: found.excludedPaths });
  });

  /** The source, for reading or remixing. Approved only — a pending app's code is not public. */
  app.get('/api/gallery/:id/source', async (req: Request, res: Response) => {
    const found = await getGalleryApp(String(req.params.id));
    if (!found || found.status !== 'approved') return res.status(404).json({ error: 'That app is not available.' });
    res.json({ id: found.id, title: found.title, files: found.files });
  });

  /**
   * Remix: hand back the files to start a new app from, and count it.
   *
   * The count is incremented only here, on a real remix — a displayed number that was not counted
   * would be a fabrication, and it is the gallery's only popularity signal.
   */
  app.post('/api/gallery/:id/remix', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!who?.uid) return res.status(401).json({ error: 'Sign in to remix an app.' });
    const found = await getGalleryApp(String(req.params.id));
    if (!found || found.status !== 'approved') return res.status(404).json({ error: 'That app is not available.' });

    await incrementRemixCount(found.id);
    res.json({
      ok: true,
      remixedFrom: found.id,
      title: `${found.title} (remix)`,
      files: found.files,
      // Honest about what a remix does NOT include, so nobody wonders why their keys are missing.
      note: 'Environment files and installed packages were not published. Add your own keys and run an install before building.',
    });
  });

  // ── admin ──────────────────────────────────────────────────────────────────────────────────────

  app.get('/api/gallery/admin/pending', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(who?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });
    const apps = await listGalleryApps('pending', 100);
    res.json({
      apps: apps.map((a) => ({
        ...toPublic(a),
        status: a.status,
        authorEmail: a.authorEmail,       // admin-only, deliberately absent from toPublic
        bytes: a.bytes,
        excludedPaths: a.excludedPaths,
        files: Object.keys(a.files),      // paths for a quick look; full source via /:id/source below
      })),
    });
  });

  /** An admin reads the actual code before approving it — that is the entire point of the queue. */
  app.get('/api/gallery/admin/:id/source', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(who?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });
    const found = await getGalleryApp(String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Not found.' });
    res.json({ id: found.id, title: found.title, status: found.status, files: found.files });
  });

  /**
   * 🔒 The ONLY path to `approved`. A removal DELETES the source, so a takedown is real rather than a
   * flag that hides code we are still storing and could still serve.
   */
  app.post('/api/gallery/admin/:id/review', async (req: Request, res: Response) => {
    const who = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(who?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });

    const decision = String(req.body?.decision || '');
    if (!['approved', 'rejected', 'removed'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved", "rejected" or "removed".' });
    }
    const found = await getGalleryApp(String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Not found.' });

    const patch: Partial<GalleryApp> = {
      status: decision as GalleryApp['status'],
      reviewedAt: Date.now(),
      reviewedBy: who?.email || '',
      reviewNote: String(req.body?.note || '').slice(0, 500),
    };
    // Rejected or removed code stops existing here, rather than sitting in a document we still hold.
    if (decision !== 'approved') patch.files = {};

    try {
      await updateGalleryApp(found.id, patch);
    } catch {
      return res.status(503).json({ error: 'Could not save that decision. Please try again.' });
    }
    res.json({ ok: true, id: found.id, status: decision });
  });
}
