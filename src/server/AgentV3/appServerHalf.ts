/**
 * DOES THIS APP HAVE A SERVER HALF? — asked ONCE, in one place, and answerable BEFORE anyone presses
 * anything.
 *
 * 🔴 WHY THIS EXISTS (admin 2026-10-17: *"website connect, databse connect, backend connect ko simple
 * banao"*). Measured, in the user's own steps, before any code was written:
 *
 *   database connect  — 1 tap (Connect Supabase → Create database).
 *   website connect   — pick app → domain → Connect → add 3 DNS records → Check → wait.
 *   backend connect   — press Publish → **be REFUSED** → the card appears → connect GitHub →
 *                       push a repo → save a key → Deploy.
 *
 * The third one begins with a failure, and that is not an accident of wording: `backendDeployOffer`
 * is gated on `publishRefusalCode`, and that code only exists after a publish attempt came back 422.
 * The app's own files have always said it has a server half — we simply did not say so until the user
 * had pressed the wrong button and lost a round trip.
 *
 * 🔑 THE CONDITION, NOT THE SYMPTOM (the fifth rule's 50/50 law). The fix is not kinder words on the
 * refusal; it is that the refusal is no longer how the user FINDS OUT. The Publish sheet reads this
 * fact when it opens, so the server-half card is simply there.
 *
 * ⚠️ AND IT MUST NOT BECOME AN AUTOMATIC DEPLOY — the trap this module is shaped to avoid. The
 * obvious implementation is to seed the client's `publishRefusalCode` from a status read. That would
 * fire `shouldAutoDeployBackend`, whose own docblock says why it watches a TRANSITION and not a
 * standing value: *"Reacting to the code merely BEING set would deploy on reopening a panel — an
 * action nobody asked for, in someone's own hosting account."* A user who merely opened a panel would
 * have a deploy running in their own Render account, on their own bill. So this fact travels as its
 * OWN field, never as a refusal code: the FACT shows the card, a FRESH REFUSAL still drives the
 * auto-deploy, and the two inputs stay separate on purpose.
 *
 * 🔑 THE OTHER CLASS THIS CLOSES: *"needs a server"* had THREE definitions. The publish route and the
 * domain status route each ran their own two-stage read, and the build-completion row asked
 * `!!planDeployment(files).backend` while the other two asked `!plan.staticHostingSufficient`. Those
 * two expressions are equivalent today — `serverHalfFromPlan` is now the only place that decides, and
 * `appServerHalf.test.ts` pins the equivalence so a new shape cannot quietly split them again.
 */

import { planDeployment, type DeployPlan } from './deployPlan';

/** The four manifests a cheap first pass can decide an ordinary static app from. */
export const SHAPE_MANIFESTS = ['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile'] as const;

/**
 * THE ONE DEFINITION. True when the app contains something a website host can never run.
 *
 * Reads `staticHostingSufficient` — the field `deployPlan` documents as "the field that fixes the
 * reported bug" — rather than `backend !== null`, because that is the field publish actually branches
 * on. The two agree for every shape the planner can return, and the test proves it.
 */
export function serverHalfFromPlan(plan: DeployPlan | null | undefined): boolean {
  return !!plan && plan.staticHostingSufficient === false;
}

/** The same answer from files already in hand — no I/O, for callers that loaded them anyway. */
export function serverHalfFromFiles(files: Record<string, string> | null | undefined): boolean {
  return serverHalfFromPlan(planDeployment(files ?? {}));
}

/**
 * Must the real files be read? True unless stage 1 reached a POSITIVE static classification.
 *
 * Exported because the gate is the part that was wrong, so it is tested directly rather than inferred
 * from a reader's behaviour. PURE.
 */
export function stageTwoNeeded(plan: DeployPlan | null | undefined): boolean {
  if (!plan) return true;
  if (serverHalfFromPlan(plan)) return true;        // suspected a server — confirm on the real files
  return plan.shape !== 'spa' && plan.shape !== 'static';   // 'unknown' is not a conclusion
}

export interface ServerHalfRead {
  plan: DeployPlan;
  hasServerHalf: boolean;
  /**
   * The real files, when the second stage ran. Kept so a caller can reuse them (the wiring analysis
   * needs them) instead of loading the workspace twice.
   */
  files: Record<string, string> | null;
}

export interface ServerHalfDeps {
  /**
   * The four manifests. Injected because the two real callers read from DIFFERENT places on purpose:
   * publish reads the SANDBOX (the freshest truth, mid-build), and a status poll reads the durable
   * store. Flattening that difference would make one of them wrong.
   */
  manifests: () => Promise<Record<string, string>>;
  /** The whole app's source. Only ever called when stage 1 says this is not an ordinary static app. */
  full: () => Promise<Record<string, string> | null>;
}

/**
 * Two stages, deliberately — the cost guarantee this read ships with.
 *
 * Stage 1 is the manifests alone and, for the ordinary static app, is the whole story: a Vite/React
 * `package.json` classifies as `spa` on the spot, and that path costs one small read, exactly what it
 * cost before.
 *
 * ⚠️ STAGE 2 IS NOT AN OPTIMISATION, IT IS A CORRECTNESS FIX (admin 2026-08-25). The manifests alone
 * cannot answer the half of the question that asks whether the app's own source IMPORTS a server
 * framework. The manifests win over the full read, because they are the fresher copy of the same file.
 *
 * 🔴 AND THE GATE ON STAGE 2 WAS A HOLE BIG ENOUGH TO RE-OPEN Q-707 — MEASURED, NOT SUPPOSED.
 *
 * Both existing staged readers (the publish route, the domain status route) ran stage 2 only
 * `if (!plan.staticHostingSufficient)` — i.e. only when stage 1 ALREADY suspected a server. For an
 * app whose server is visible ONLY in its source, stage 1 cannot suspect anything:
 *
 *     planDeployment({ 'package.json': '{"scripts":{"start":"node server.js"}}' })
 *        → shape 'unknown', staticHostingSufficient TRUE          ⇒ stage 2 never ran
 *     planDeployment({ ...the real files })
 *        → shape 'node-server', staticHostingSufficient FALSE      ⇒ the truth, never reached
 *
 * That is Q-707's bug exactly — *"an app whose server is plain `node:http` was published as a STATIC
 * SITE, with its API dead and the user told it worked"* — alive again, not because the detector was
 * wrong but because the real files were never handed to it. `coreHttpServer.test.ts` proves the
 * detector on full files, and nothing proved that the publish path ever supplies them.
 *
 * 🔑 SO THE GATE IS "STAGE 1 DID NOT CONCLUDE", NOT "STAGE 1 SUSPECTS A SERVER". `spa` and `static`
 * are positive classifications and end the read. `unknown` is not a conclusion — treating it as
 * "static, done" is silence mistaken for safety, which is the whole class this repo keeps paying for.
 * The planner's safe default stays exactly as it is (an app we cannot classify is still published as
 * files); what changes is that we LOOK before defaulting.
 *
 * NEVER THROWS, and silence on doubt: an unreadable workspace yields the planner's safe default
 * (static, `hasServerHalf: false`), so a surface that cannot read the app says exactly what it says
 * today instead of telling a user their perfectly publishable app needs a server.
 */
export async function readServerHalf(deps: ServerHalfDeps): Promise<ServerHalfRead> {
  const manifests = await deps.manifests().catch(() => ({} as Record<string, string>));
  let plan = planDeployment(manifests);
  let files: Record<string, string> | null = null;
  if (stageTwoNeeded(plan)) {
    files = await deps.full().catch(() => null);
    if (files) plan = planDeployment({ ...files, ...manifests });
  }
  return { plan, hasServerHalf: serverHalfFromPlan(plan), files };
}
