/**
 * Client half of the feature card (server: src/server/AgentV3/featurePlan.ts). PURE apart from the one
 * per-viewer preference, whose every read and write is wrapped because storage can be blocked.
 */

export interface FeaturePlanView {
  show: boolean;
  named: string[];
  suggested: string[];
  domain: string;
}

export const FEATURE_CONFIRM_PREF_KEY = 'nbai.featureConfirm.off';

/** True when the viewer chose "don't ask again". Unreadable storage ⇒ ask (the safe, visible default). */
export function featureConfirmDisabled(): boolean {
  try { return window.localStorage.getItem(FEATURE_CONFIRM_PREF_KEY) === '1'; } catch { return false; }
}

export function setFeatureConfirmDisabled(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(FEATURE_CONFIRM_PREF_KEY, '1');
    else window.localStorage.removeItem(FEATURE_CONFIRM_PREF_KEY);
  } catch { /* a preference that cannot be saved just asks again next time */ }
}

/**
 * Only the FIRST build of a new app. An edit, a follow-up, an import or a file-driven turn has no list
 * of features to confirm — and pausing those would be friction with nothing behind it.
 */
export function shouldOfferFeatureCard(input: {
  buildMode: boolean;
  hasWorkspace: boolean;
  priorTurns: number;
  importing: boolean;
  hasAttachments: boolean;
  programmatic: boolean;
  disabled: boolean;
}): boolean {
  return input.buildMode && !input.hasWorkspace && input.priorTurns === 0
    && !input.importing && !input.hasAttachments && !input.programmatic && !input.disabled;
}

/** Everything the user asked for starts ticked; a suggestion starts ticked too — one tap accepts all. */
export function initialSelection(plan: FeaturePlanView): Set<string> {
  return new Set([...plan.named, ...plan.suggested]);
}

/** The answer sent with the build: what was kept and what was removed, from what was offered. */
export function confirmationFrom(plan: FeaturePlanView, selected: ReadonlySet<string>): { include: string[]; exclude: string[] } {
  const offered = [...plan.named, ...plan.suggested];
  return {
    include: offered.filter((l) => selected.has(l)),
    exclude: offered.filter((l) => !selected.has(l)),
  };
}
