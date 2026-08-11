/**
 * Community gallery — the invariants that live in the ROUTE, not in a helper.
 *
 * Two things must be true for this feature to be safe to have at all, and neither is provable by
 * testing the helpers alone:
 *   1. Publishing can ONLY ever produce `pending`. No request body, no field, no code path in the
 *      publish route may produce `approved` — only an admin acting on the review route can.
 *   2. Every public read is filtered to `approved`. A pending app's SOURCE is not public; that is the
 *      whole reason a review queue exists.
 *
 * These are asserted against the route source, in the same style as the T0-9 ownership tests, because
 * the alternative — booting Express and Firestore — would test the mocks rather than the rules.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const SRC = readFileSync(fileURLToPath(new URL('../src/server/routes/gallery.ts', import.meta.url)), 'utf8');

/** One handler's body — sliced to the next route registration, never a fixed character count. */
function handlerOf(method: 'get' | 'post', path: string): string {
  const i = SRC.indexOf(`app.${method}('${path}'`);
  if (i === -1) return '';
  const next = SRC.slice(i + 1).search(/\n\s{2}app\.(post|get|put|patch|delete)\s*\(/);
  return next === -1 ? SRC.slice(i) : SRC.slice(i, i + 1 + next);
}

describe('🔒 publishing can only ever produce "pending"', () => {
  const publish = handlerOf('post', '/api/gallery/publish');

  it('the publish handler exists and sets status: pending', () => {
    expect(publish).not.toBe('');
    expect(publish).toContain("status: 'pending'");
  });

  it('🔒 the publish handler never writes "approved" anywhere', () => {
    // A clean secret scan proves no key leaked. It does not prove the code is something we want to
    // host and hand to other users to run — that is a human decision, and this is what keeps it one.
    expect(publish).not.toContain("'approved'");
  });

  it('🔒 status is not taken from the request body', () => {
    // `status: req.body.status` would let a publisher approve their own app.
    expect(publish).not.toMatch(/status:\s*(req\.body|String\(req\.body)/);
  });

  it('runs the secret gate BEFORE building the record, and refuses on a blocker', () => {
    const gateAt = publish.indexOf('preparePublishBundle');
    const recordAt = publish.indexOf('const record');
    expect(gateAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(gateAt);       // the gate cannot be after the record is built
    expect(publish).toContain('if (!bundle.ok)');
    expect(publish).toContain('res.status(422)');
  });

  it('stores only the files the gate returned — never the raw request', () => {
    expect(publish).toContain('files: bundle.files');
    expect(publish).not.toMatch(/files:\s*files\b/);
  });

  it('requires a signed-in publisher', () => {
    expect(publish).toContain('verifyFirebaseIdentity');
    expect(publish).toContain('res.status(401)');
  });
});

describe('🔒 only approved apps are ever public', () => {
  for (const [method, path] of [
    ['get', '/api/gallery/:id'],
    ['get', '/api/gallery/:id/source'],
    ['post', '/api/gallery/:id/remix'],
  ] as const) {
    it(`${method.toUpperCase()} ${path} refuses anything not approved`, () => {
      const h = handlerOf(method, path);
      expect(h, path).not.toBe('');
      expect(h, path).toContain("found.status !== 'approved'");
      expect(h, path).toContain('res.status(404)');
    });
  }

  it('the public listing asks the store for approved records only', () => {
    const list = handlerOf('get', '/api/gallery');
    expect(list).toContain("listGalleryApps('approved'");
    expect(list).not.toContain("'pending'");
  });

  it('the public listing returns the redacted shape, never the raw record', () => {
    // toPublic drops the source and the publisher's email.
    const list = handlerOf('get', '/api/gallery');
    expect(list).toContain('toPublic');
    expect(list).not.toMatch(/apps:\s*(filtered|apps)\s*\}/);
  });
});

describe('🔒 the admin routes are the only path to approved', () => {
  const review = handlerOf('post', '/api/gallery/admin/:id/review');

  it('every admin route checks isStoreAdmin and 403s', () => {
    for (const [method, path] of [
      ['get', '/api/gallery/admin/pending'],
      ['get', '/api/gallery/admin/:id/source'],
      ['post', '/api/gallery/admin/:id/review'],
    ] as const) {
      const h = handlerOf(method, path);
      expect(h, path).toContain('isStoreAdmin');
      expect(h, path).toContain('res.status(403)');
    }
  });

  it('accepts only the three real decisions', () => {
    expect(review).toContain("['approved', 'rejected', 'removed'].includes(decision)");
    expect(review).toContain('res.status(400)');
  });

  it('🔒 a rejection or removal DELETES the source — a takedown must be real', () => {
    // Leaving the code in a document we still hold, behind a status flag, is not a takedown.
    expect(review).toContain("if (decision !== 'approved') patch.files = {};");
  });

  it('records who decided and when, so a decision is attributable', () => {
    expect(review).toContain('reviewedBy');
    expect(review).toContain('reviewedAt');
  });
});

describe('honesty of what a remix gives you', () => {
  it('says out loud that env files and packages were not published', () => {
    const remix = handlerOf('post', '/api/gallery/:id/remix');
    expect(remix).toContain('Environment files and installed packages were not published');
  });

  it('counts a remix only on a real remix', () => {
    const remix = handlerOf('post', '/api/gallery/:id/remix');
    expect(remix).toContain('incrementRemixCount');
    // Not on a plain read — that would inflate the only popularity signal the gallery has.
    expect(handlerOf('get', '/api/gallery/:id/source')).not.toContain('incrementRemixCount');
    expect(handlerOf('get', '/api/gallery/:id')).not.toContain('incrementRemixCount');
  });

  it('tells the publisher their app is waiting for review, not that it is live', () => {
    expect(handlerOf('post', '/api/gallery/publish')).toContain('once an admin approves it');
  });

  it('says the gallery is closed rather than accepting an app it cannot keep', () => {
    const publish = handlerOf('post', '/api/gallery/publish');
    expect(publish).toContain('isGalleryConfigured');
    expect(publish).toContain('res.status(503)');
  });
});
