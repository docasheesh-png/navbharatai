import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ownedByVerifiedUid } from '../src/server/lib/workspaceIdentity';

/**
 * PAID-SURFACE AUDIT (admin 2026-08-12): "kaun sa taala server par hai, kaun sa sirf screen par."
 *
 * The paid surfaces came back clean — the build wallet, the ₹1 APK charge, the image quota and the
 * power tiers are all enforced server-side, and the three unauthenticated AI routes in pro.ts were
 * already retired with an honest 410. The Pro-template "lock" only nudges a signed-out visitor to sign
 * in; the build behind it still goes through the fully-gated pipeline.
 *
 * What the sweep DID find was a different class, one door over: routes that check WHO you are and
 * never check WHOSE WORKSPACE you just named.
 *
 *   codeReview.ts    — verified a sign-in, then read AND wrote review comments at the workspace id
 *                      from the URL. Any signed-in user could read or write anyone's threads.
 *   traceability.ts  — NO authentication at all. The GET read another user's requirement text and file
 *                      paths from a query string; the POST overwrote their stored matrix.
 *   sbom.ts          — NO authentication. Wrote an SBOM into `sboms/{workspaceId}` from the body.
 *
 * "Signed in" answers who you are. It says nothing about whose data you asked for. The repo already
 * had the answer — `ownedByVerifiedUid`, used by appDebug and nbaiDomains — these three files simply
 * never called it.
 */

const routesDir = join(process.cwd(), 'src/server/routes');
const read = (f: string) => readFileSync(join(routesDir, f), 'utf8');

describe('the three routes the audit found', () => {
  it('codeReview gates every route through ONE ownership check', () => {
    const src = read('codeReview.ts');
    expect(src).toContain('ownedByVerifiedUid(uid, workspaceId)');
    // Four routes, one gate. Four separate checks is four chances to write three of them — which is
    // exactly how this file ended up with none.
    expect((src.match(/await ownedWorkspace\(req, res,/g) || []).length).toBe(4);
    // …and the workspace id used downstream is the CHECKED one, never re-read from the URL.
    expect(src).not.toMatch(/codeReviewStore\.\w+\(String\(req\.params\.workspaceId/);
  });

  it('codeReview verifies the token ONCE per request', () => {
    // The gate returns the uid so the two authoring routes do not pay for a second verification.
    expect((read('codeReview.ts').match(/verifyFirebaseToken\(req\)/g) || []).length).toBe(1);
  });

  it('traceability requires an owner to READ a stored matrix', () => {
    const src = read('traceability.ts');
    expect(src).toContain('const owned = await ownerOf(req, String((req.query as { workspaceId?: string }).workspaceId');
    expect(src).toContain('traceabilityStore.loadLatest(owned)');
  });

  it('traceability requires an owner to WRITE one', () => {
    expect(read('traceability.ts')).toContain('traceabilityStore.save(owned, matrix)');
  });

  it('sbom writes only into a workspace the caller owns', () => {
    const src = read('sbom.ts');
    expect(src).toContain('ownedByVerifiedUid(await verifyFirebaseToken(req), workspaceId)');
    expect(src).toContain("await setDoc(doc(db, 'sboms', ownedWorkspaceId,");
  });

  it('the COMPUTATION stays open — only stored data is gated', () => {
    /**
     * THE LINE THAT KEEPS THIS A SECURITY FIX AND NOT A FEATURE REGRESSION. Both routes compute over
     * data the caller sent in the request body, so the result reveals nothing they did not already
     * have. Gating the maths would break the IDE's use of it on an unsaved draft for no security gain.
     */
    expect(read('traceability.ts')).toMatch(/The COMPUTATION is left open on purpose/);
    expect(read('sbom.ts')).toMatch(/still computed\s*\n\s*\/\/ and returned from the lockfile/);
  });

  it('a foreign workspace gets 404, never 403', () => {
    // "That exists, but it isn't yours" confirms the id, which is half of what a prober came for.
    expect(read('codeReview.ts')).toContain("res.status(404).json({ error: 'Workspace not found.' })");
    expect(read('traceability.ts')).toMatch(/Same 404 for "not yours" and "not there"/);
  });
});

describe('the ownership rule itself', () => {
  it('the owner passes and a stranger does not', () => {
    expect(ownedByVerifiedUid('alice', 'agentv3-alice-sess1')).toBe(true);
    expect(ownedByVerifiedUid('mallory', 'agentv3-alice-sess1')).toBe(false);
  });

  it('an unverified caller passes nothing', () => {
    expect(ownedByVerifiedUid(null, 'agentv3-alice-sess1')).toBe(false);
    expect(ownedByVerifiedUid('', 'agentv3-alice-sess1')).toBe(false);
  });

  it('a prefix that merely STARTS the same is not the same owner', () => {
    // 'alice' must not open 'alicia'. The trailing dash in the prefix is what makes that true.
    expect(ownedByVerifiedUid('alice', 'agentv3-alicia-sess1')).toBe(false);
  });

  it('junk ids are refused rather than parsed hopefully', () => {
    for (const id of ['', 'agentv3-', 'nope', null, undefined, 42]) {
      expect(ownedByVerifiedUid('alice', id as unknown), String(id)).toBe(false);
    }
  });
});

describe('CENSUS TRIPWIRE — a new workspace route must consider ownership', () => {
  /**
   * The per-file tests above lock the three we found. This locks the CLASS: a route file that takes a
   * workspace id and never mentions an identity check fails here, and whoever added it has to prove
   * the case was considered rather than discovering it in the next audit.
   */
  it('no route file reads a workspace id without any identity check', () => {
    /**
     * Two valid patterns, not one:
     *  - CHECK  — the id came from the caller and is compared against a verified identity;
     *  - DERIVE — the id is BUILT from the verified uid (`sessionWorkspaceId`, `workspacePrefixFor`),
     *             so a caller cannot name someone else's workspace at all. minify.ts and
     *             workspaceFiles.ts do this, and it is the stronger of the two — there is no check to
     *             forget because there is nothing to check.
     */
    const OWNERSHIP = /ownedByVerifiedUid|verifiedWorkspaceReadOk|workspaceOwnershipOk|verifyAdminToken|verifyFirebaseIdentity|verifiedIdentity|ANON_WORKSPACE_PREFIX|sessionWorkspaceId|workspacePrefixFor|workspaceIdFor/;
    const USES_ID = /params\.workspaceId|body[\s\S]{0,40}workspaceId|query[\s\S]{0,40}workspaceId/;
    const offenders: string[] = [];
    for (const f of readdirSync(routesDir)) {
      if (!f.endsWith('.ts') || f.includes('.test.')) continue;
      const src = read(f);
      if (USES_ID.test(src) && !OWNERSHIP.test(src)) offenders.push(f);
    }
    /**
     * `supabaseIntegration.ts` is the one allowed entry: its workspace id rides an OAuth `state` that
     * the server itself signed and re-verifies, so the id is not caller-supplied in the sense that
     * matters here. Every other route must carry a real ownership check.
     */
    expect(offenders).toEqual(['supabaseIntegration.ts']);
  });
});
