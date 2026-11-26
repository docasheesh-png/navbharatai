// ONE preparation of a NavBharatAI app into a buildable Capacitor project — shared by both Android build
// providers (2026-11-25).
//
// Moved VERBATIM out of `POST /api/mobile-ship/setup` (routes/mobileSetup.ts), where it was written for
// the GitHub provider. None of it ever needed GitHub: the compile pre-flight and its AI heal, the
// no-screens refusal, the production build in the app's own sandbox, the ship kit, the app's own images,
// the logo decision, the assembly, the missing-asset and missing-page refusals. The Native Cloud Build
// needs every one of those guarantees too, so instead of a second copy that would drift (the
// `safeRelPath` class), both providers call this. Each refusal carries the SAME status and body the
// setup route always sent, so its callers and tests see no difference.

import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../../AgentV3/WorkspaceFileStore';
import { loadWorkspaceAssetsWithCompleteness } from '../../AgentV3/WorkspaceAssetStore';
import { decideLogo } from '../appBranding';
import { findMissingImportedAssets, missingAssetUserMessage } from '../../AgentV3/missingAssetCheck';
import { generateShipKit, type ShipKitResult } from '../mobileShipKit';
import { assembleMobileProject, capacitorMajorFromFiles, missingWebPageRefusal, type AssembledProject } from '../mobileProjectAssembler';
import { preflightAndHeal, preflightUserMessage } from '../mobileShipPreflight';
import { runRealBuildCheck, type RealBuildVerdict } from '../mobileShipRealBuild';
import { prebuildForShip, type PrebuiltOutcome } from '../mobileShipPrebuilt';
import { buildActuator } from '../../routes/actuatorFactory';
import { aiRepairEnabled, aiRepairModelChain, type RepairTier } from '../mobileBuildAiRepair';
import { callRepairModel } from '../mobileBuildAiRepairClient';
import { apkRefusalForProject } from '../frameworkCapability';

/** A refusal, already in the shape the HTTP route sends. */
export interface PrepareRefusal { ok: false; status: number; body: Record<string, unknown> }

export interface PreparedProject {
  ok: true;
  project: AssembledProject;
  kit: ShipKitResult;
  prebuild: PrebuiltOutcome;
  /** The pre-flight's notes; the route reports them before the assembler's. */
  preflightNotes: string[];
}

/** Read the app's files, refusing an empty app with the setup route's own wording. */
export async function loadAppFilesForShip(workspaceId: string): Promise<{ ok: true; files: Record<string, string> } | PrepareRefusal> {
  let files: Record<string, string>;
  try {
    files = await loadWorkspaceFiles(workspaceId);
  } catch {
    return { ok: false, status: 502, body: { error: 'Could not read that app’s files.' } };
  }
  if (Object.keys(files).length === 0) {
    return {
      ok: false,
      status: 422,
      body: { error: 'That app has no files yet, so there is nothing to package. Build it with NavBharatAI Pro first.' },
    };
  }
  return { ok: true, files };
}

export interface PrepareInput {
  workspaceId: string;
  appFiles: Record<string, string>;
  appName: string;
  appId?: string;
  iconDataUrl?: string;
  backgroundColor?: string;
  ios: boolean;
  repairTier: RepairTier;
}

/**
 * Everything between "the app's files are loaded" and "a complete Capacitor project with its workflows".
 * The reasoning behind each gate is kept beside it in routes/mobileSetup.ts history and in the modules
 * named here; the order is the order the setup route always used.
 */
export async function prepareMobileProject(input: PrepareInput): Promise<PreparedProject | PrepareRefusal> {
  const { workspaceId, appName: name } = input;

  // Compile pre-flight: verify here, heal here, and write every heal back into the user's own app.
  const preflight = await preflightAndHeal(
    input.appFiles,
    callRepairModel,
    aiRepairEnabled() ? aiRepairModelChain(process.env, input.repairTier) : [],
  );
  if (!preflight.ok) {
    return {
      ok: false,
      status: 422,
      body: { error: preflightUserMessage(preflight.problems), compileProblems: preflight.problems.slice(0, 10) },
    };
  }
  if (Object.keys(preflight.changed).length > 0) {
    try { await mergeWorkspaceFiles(workspaceId, preflight.changed); } catch { /* the build still proceeds */ }
  }
  const appFiles = preflight.files;

  // A server-only project (JSON API, no screens) would become an APK that opens to a blank page.
  const noUi = apkRefusalForProject(appFiles);
  if (noUi) return { ok: false, status: 422, body: { error: noUi, code: 'no-ui' } };

  // The app's own production build, in its own sandbox; its output ships as `www/`.
  const prebuild = await prebuildForShip(buildActuator(), workspaceId, appFiles, preflight.changed)
    .catch((): PrebuiltOutcome => ({ kind: 'skip', reason: 'unavailable', buildRan: false }));
  if (prebuild.kind === 'refuse') {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Your app did not compile, so the phone build would have failed too. ${prebuild.summary}`,
        code: 'real-build-failed',
        failureCode: prebuild.code,
        buildLog: prebuild.log.slice(-2000),
      },
    };
  }
  const realBuild: RealBuildVerdict = prebuild.kind === 'skip' && !prebuild.buildRan
    ? await runRealBuildCheck(buildActuator(), workspaceId, appFiles, preflight.changed)
      .catch(() => ({ ran: false as const, reason: 'unavailable' as const }))
    : { ran: false, reason: 'prebuilt' };
  if (realBuild.ran && !realBuild.ok && realBuild.blocking) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Your app did not compile, so the phone build would have failed too. ${realBuild.summary}`,
        code: 'real-build-failed',
        failureCode: realBuild.code,
        buildLog: realBuild.log.slice(-2000),
      },
    };
  }

  // Pin the Android JDK to what THIS app's Capacitor major needs, so toolchain and app never disagree.
  const capacitorMajor = capacitorMajorFromFiles(appFiles) ?? undefined;
  const kit = generateShipKit({ appName: name, appId: input.appId, ios: input.ios, capacitorMajor });
  // The app's own images and fonts; completeness travels with them so a failed read is never reported
  // to the user as "your app is missing these files".
  const assetLoad = await loadWorkspaceAssetsWithCompleteness(workspaceId)
    .catch(() => ({ assets: {} as Record<string, string>, complete: false }));
  const appAssets = assetLoad.assets;
  const logo = decideLogo({ iconDataUrl: input.iconDataUrl });
  const project = assembleMobileProject(appFiles, kit.files, {
    appName: name,
    appId: input.appId ?? kit.appId,
    iconDataUrl: input.iconDataUrl,
    branding: logo,
    backgroundColor: input.backgroundColor,
    ios: input.ios,
    appAssets,
    appAssetsComplete: assetLoad.complete,
    prebuilt: prebuild.kind === 'built' ? prebuild.prebuilt : undefined,
  });

  // On a prebuilt ship the bundle already resolved every import, so this is the SOURCE ship's gate.
  const missingAssets = project.prebuilt ? [] : findMissingImportedAssets(appFiles, Object.keys(appAssets));
  if (missingAssets.length > 0) {
    return {
      ok: false,
      status: 422,
      body: { error: missingAssetUserMessage(missingAssets), code: 'missing-assets', missingAssets: missingAssets.slice(0, 10) },
    };
  }

  // A static app with no page where Capacitor opens one can never produce a working build.
  const noPage = missingWebPageRefusal(project);
  if (noPage) return { ok: false, status: 422, body: { error: noPage, code: 'no-web-page' } };

  return { ok: true, project, kit, prebuild, preflightNotes: preflight.notes };
}
