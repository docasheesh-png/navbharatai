// THE THIRD-PARTY SOURCES WHOSE LICENCE DOES NOT COVER WHAT WE ARE (admin 2026-09-09).
//
// WHY THIS EXISTS. Two integrations run on free tiers that their own terms reserve for NON-COMMERCIAL
// use, and NavBharatAI charges money — so the exposure is live TODAY, not at some future scale. Both
// have been recorded as open items in CLAUDE.md and PROGRESS.md for weeks. That is where the problem
// is: a risk written in a 46,000-line document is a risk nobody can act on. The admin is not
// technical and does not read the source; the first they would learn of it is a letter.
//
// 🔒 WHAT MAKES THIS A FEATURE RATHER THAN DOCUMENTATION IN A .ts FILE. The register does not
// *describe* whether a source is running — it reads the SAME switch the source itself obeys
// (`liveWeatherSourceEnabled`, imported by liveDataSources.ts). A register that kept its own opinion
// could say "off" while the calls kept going out, which is worse than no register at all: it would be
// a false assurance about a legal exposure. One function, one truth, both sides.
//
// 🔒 AND THE HONEST HALF (rule 6). Switching a source off is a MITIGATION, not the fix. The real fix
// for both entries is a PURCHASE — a paid plan, or a replacement with terms that cover commercial
// use — and that is the admin's decision to make, not something a session can write. Every entry
// therefore carries `honestFix` in plain words, and the card shows it, so turning something off is
// never mistaken for having solved it.
//
// PURE — env in, verdicts out. No I/O, no clock.

/**
 * Is the restricted weather source allowed to run? Read by BOTH the register and the source itself.
 *
 * 🔴 THE DEFAULT IS **OFF** SINCE 2026-09-20, AND THE FLIP IS THE WHOLE POINT (admin: "free me jo
 * ho woh" — take whichever option costs nothing). It used to default ON, so the exposure was live on
 * every deployment unless somebody went and typed a value into a console. A licence risk that is
 * on-by-default and off-by-effort is backwards: the effort belongs on the side that costs money.
 *
 * Nothing breaks. Weather questions fall through to the caller's web search, which already answers
 * them — exactly as gold rates and cinema showtimes are answered today.
 *
 * ⚠️ IT IS NOW AN ENABLE SWITCH, NOT A KILL SWITCH, so `off` is no longer the word that matters:
 * only the explicit `on` starts it. That is deliberate — anything unreadable, blank or mistyped
 * leaves the restricted source silent rather than running, which is the safe direction for a legal
 * exposure. The day a commercial plan is bought, `LIVE_WEATHER_SOURCE=on` turns it back on with no
 * deploy.
 *
 * ✅ AQI IS NOT ON THIS SWITCH. It moved to CPCB's own feed, which is licensed for commercial use,
 * and carries its own gate. Pausing the problem must not pause the fix.
 */
export function liveWeatherSourceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.LIVE_WEATHER_SOURCE ?? '').trim().toLowerCase() === 'on';
}

/** How an exposure stands right now. */
export type ExposureState =
  /** Configured and running — the licence risk is live. */
  | 'active'
  /** Deliberately switched off — no calls go out, the feature degrades honestly. */
  | 'switched-off'
  /** Never configured on this deployment, so nothing is being used. */
  | 'not-configured';

export interface LicenceExposure {
  id: string;
  /** The service, named plainly — this card is read by the admin, not by an engineer. */
  name: string;
  /** What stops working if it is switched off. The admin must be able to weigh the trade. */
  powers: string;
  /** Why it is a risk, in one sentence. */
  restriction: string;
  /** What ACTUALLY closes it. Almost always a purchase — say so rather than implying code can. */
  honestFix: string;
  /** What happens the moment it is switched off — so "off" is never a surprise. */
  whenOff: string;
  /** The env that controls it, or null when the credential itself is the only switch. */
  killSwitch: string | null;
  /** The env whose presence means this integration is live at all, or null when it needs no key. */
  requires: string | null;
  /**
   * The exact sentence the admin card shows about the switch.
   *
   * 🔒 IT LIVES ON THE ROW, NOT IN THE COMPONENT. The card used to build this line itself and always
   * said "set <KEY>=off" — which became FALSE the moment a source's default flipped to off and `on`
   * became the word that matters. A screen that tells an admin to type the wrong value into a legal
   * control is worse than one that says nothing.
   */
  switchHint: string;
  /**
   * Whether this source is RUNNING, asked of the source's own function.
   *
   * 🔒 ONE RULE, ONE IMPLEMENTATION. `exposureState` used to re-derive "is it off?" with its own
   * string comparison while the source obeyed `liveWeatherSourceEnabled` — two implementations of
   * one rule, which is exactly how a panel comes to say "off" while the calls keep going out. The
   * register now ASKS. Omit it for a source whose only switch is its credential.
   */
  isRunning?: (env: NodeJS.ProcessEnv) => boolean;
}

/**
 * The register.
 *
 * Deliberately SHORT and hand-maintained: this is not an npm licence scanner (that is a different
 * problem, already covered by the dependency-health gate). It lists the small number of RUNTIME
 * SERVICES whose terms conflict with being a commercial product — the ones a scanner cannot see
 * because they are HTTP calls, not packages.
 */
export const LICENCE_EXPOSURES: readonly LicenceExposure[] = [
  {
    id: 'virustotal',
    name: 'App Store malware scanning',
    powers: 'Every app uploaded to the Nav App Store is scanned before it can be published.',
    restriction: 'It runs on a free public API whose terms do not permit use inside a commercial product, and which is rate-limited (about 4 requests a minute, 500 a day).',
    honestFix: 'Buy a VirusTotal commercial plan, or move to a scanner whose terms cover commercial use. This cannot be fixed in code.',
    whenOff: 'Publishing to the App Store STOPS for everyone — no app can be approved without a scan, by design. Nothing unscanned is ever let through.',
    killSwitch: null, // the credential is the switch; its absence already fails closed
    requires: 'VIRUSTOTAL_API_KEY',
    switchHint: 'Switch: remove VIRUSTOTAL_API_KEY — publishing then blocks, by design',
  },
  {
    // ✅ THE AQI HALF LEFT THIS ROW ON 2026-09-20 (admin: "use karo!!"). Air quality now comes from
    // CPCB via data.gov.in under the Government Open Data License – India, which permits commercial
    // use in terms — so it is no longer an exposure and is no longer named here. WEATHER still runs
    // on the restricted tier, which is why this row is still RUNNING.
    //
    // 🔒 The wording had to move with the code, and that is rule 5 rather than tidiness: this row
    // is the ONE place the admin learns what a licence risk covers. Leaving it saying "Weather and
    // AQI" would have overstated a legal exposure on the exact screen used to judge it, and would
    // have made the half that was fixed invisible.
    id: 'open-meteo',
    name: 'Live weather',
    powers: 'Weather answers in the chat assistants. (Air quality moved to CPCB\'s official feed on 2026-09-20 and is no longer affected.)',
    restriction: 'The no-key tier is licensed for non-commercial use only. It needs no credential, which is exactly why it is easy to leave running without noticing.',
    honestFix: 'Buy the provider\'s commercial tier (about $29 a month), or switch to a source whose free tier permits commercial use. This cannot be fixed in code.',
    whenOff: 'Weather questions fall through to the normal web search, which already answers them. AQI is unaffected — it runs on a separate, properly licensed source. Nothing breaks and no answer is invented.',
    killSwitch: 'LIVE_WEATHER_SOURCE',
    requires: null, // needs no key at all — the reason it is easy to miss
    switchHint: 'Off by default since 2026-09-20. To run it again after buying the plan: set LIVE_WEATHER_SOURCE=on in Cloud Run.',
    isRunning: liveWeatherSourceEnabled,
  },
];

/**
 * Where one exposure stands. `switched-off` wins over everything: a source that is off is not being
 * used, whatever its credential says.
 */
export function exposureState(
  exposure: LicenceExposure,
  env: NodeJS.ProcessEnv = process.env,
): ExposureState {
  // The source's OWN function decides, so the panel cannot hold a second opinion about whether
  // calls are going out. See `isRunning` for why this is not merely tidier.
  if (exposure.isRunning && !exposure.isRunning(env)) return 'switched-off';
  if (exposure.requires) {
    return String(env[exposure.requires] ?? '').trim() ? 'active' : 'not-configured';
  }
  return 'active';
}

export interface ExposureRow extends LicenceExposure {
  state: ExposureState;
}

/** The whole register, each row resolved against the live environment. */
export function licenceExposures(env: NodeJS.ProcessEnv = process.env): ExposureRow[] {
  return LICENCE_EXPOSURES.map((e) => ({ ...e, state: exposureState(e, env) }));
}

/** How many are running right now — the one number the card leads with. */
export function activeExposureCount(env: NodeJS.ProcessEnv = process.env): number {
  return licenceExposures(env).filter((r) => r.state === 'active').length;
}

/**
 * The card's headline.
 *
 * Never alarming and never reassuring beyond the facts: it states the count and, when something is
 * running, that the fix is a commercial decision. "0 running" is not "solved" — it is "not currently
 * exposed", and the wording says so, because a source switched off today is one env change from being
 * on again.
 */
export function licenceExposureHeadline(env: NodeJS.ProcessEnv = process.env): string {
  const rows = licenceExposures(env);
  const active = rows.filter((r) => r.state === 'active');
  if (active.length === 0) {
    return `None of the ${rows.length} restricted sources is running right now. They stay listed here because switching one back on is a single setting.`;
  }
  const names = active.map((r) => r.name).join(', ');
  return `${active.length} of ${rows.length} restricted sources ${active.length === 1 ? 'is' : 'are'} running: ${names}. Each one needs a commercial plan or a replacement — switching it off is a pause, not a fix.`;
}
