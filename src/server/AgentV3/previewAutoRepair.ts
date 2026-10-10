// AgentV3 — a crash the user hits AFTER the build ended is repaired once, automatically, when the
// platform can see it too (Q-148, admin-approved option (b) 2026-10-05).
//
// `/preview-error` only ever wrote the crash into the report; the user had to notice it, open the chat and
// press "Fix with AI". The admin chose (b): repair automatically, but ONLY when every one of these holds —
//   • the build has ENDED (a running build handles its own errors);
//   • it ran on a PAID tier (the free tier's spend is NavBharatAI's, so it keeps the button);
//   • it is the FIRST automatic repair of this build (once per build, recorded on the report);
//   • the platform REPRODUCED the crash in its own browser — the sandbox's headless Chromium, on a sandbox
//     that is already awake (it is never started just to check). A report the platform cannot reproduce
//     might be the visitor's browser, an extension, or a flaky network; it keeps the button.
// The repair itself is an ordinary build turn the client sends, billed exactly like a pressed "Fix with
// AI" — nothing here spends anything. Kill switch AGENTV3_PREVIEW_AUTO_REPAIR=off. PURE.

/** In-memory claim so two crash reports cannot both pass the check before the durable write lands (BLD-11). */
const autoRepairClaims = new Map<string, number>();
export const AUTO_REPAIR_CLAIM_MS = 120_000;

/** True when this call won the claim. Synchronous — call it before any await. */
export function claimAutoRepair(workspaceId: string, now = Date.now(), cooldown = AUTO_REPAIR_CLAIM_MS): boolean {
  const last = autoRepairClaims.get(workspaceId) ?? 0;
  if (now - last < cooldown) return false;
  autoRepairClaims.set(workspaceId, now);
  return true;
}
export function previewAutoRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PREVIEW_AUTO_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

export interface AutoRepairFacts {
  /** The build's report exists and has an end time. */
  buildEnded: boolean;
  /** The resolved power level the build ran at ('weak' is the free tier). */
  powerLevel?: string | null;
  /** True when the build ran with Claude excluded (the cheap/free tier). */
  noClaude?: boolean;
  /** When this build was last repaired automatically, if ever. */
  previewAutoRepairAt?: number | null;
  /** Did the platform's own browser see an actionable error? null = it could not look. */
  reproduced: boolean | null;
}

export interface AutoRepairDecision {
  run: boolean;
  /** One sentence, shown in the admin's report and returned to the client. */
  reason: string;
}

/** Is this build one the user paid for? An unknown tier is NOT paid — the button stays. */
export function ranOnPaidTier(f: Pick<AutoRepairFacts, 'powerLevel' | 'noClaude'>): boolean {
  if (f.noClaude) return false;
  const level = String(f.powerLevel ?? '').trim().toLowerCase();
  return level !== '' && level !== 'weak';
}

/** The checks that need no sandbox, in order. Null when they all pass. */
export function autoRepairPrecheck(f: Omit<AutoRepairFacts, 'reproduced'>): AutoRepairDecision | null {
  if (!f.buildEnded) return { run: false, reason: 'The build is still running — it handles its own errors.' };
  if (typeof f.previewAutoRepairAt === 'number' && f.previewAutoRepairAt > 0) {
    return { run: false, reason: 'This build was already repaired automatically once — the Fix with AI button is next.' };
  }
  if (!ranOnPaidTier(f)) return { run: false, reason: 'Automatic repair is for paid builds; the Fix with AI button repairs this one.' };
  return null;
}

/** The full decision. */
export function autoRepairDecision(f: AutoRepairFacts): AutoRepairDecision {
  const pre = autoRepairPrecheck(f);
  if (pre) return pre;
  if (f.reproduced !== true) {
    return {
      run: false,
      reason: f.reproduced === false
        ? 'The platform opened the app in its own browser and did not see this crash, so it was not repaired automatically.'
        : 'The platform could not open the app in its own browser to confirm the crash, so it was not repaired automatically.',
    };
  }
  return { run: true, reason: 'The platform reproduced this crash in its own browser — repairing it once, automatically.' };
}

/** The repair request the client sends as the next turn. */
export function autoRepairPrompt(reported: string, seen: readonly string[]): string {
  const lines = seen.slice(0, 5).map((s) => `- ${String(s).replace(/\s+/g, ' ').trim().slice(0, 300)}`);
  return [
    'Automatic repair (once): the app crashes after the build finished, and NavBharatAI reproduced the crash in its own browser.',
    `What the preview reported: ${String(reported ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)}`,
    lines.length ? `What NavBharatAI's browser saw:\n${lines.join('\n')}` : '',
    'Find the root cause in the code and fix it, keep every feature that works, and verify the app renders without the error.',
  ].filter(Boolean).join('\n\n');
}
