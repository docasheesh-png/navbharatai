/**
 * Process-wide in-memory server stats / runtime config singleton.
 * Extracted from the server.ts monolith (Phase 1) so route modules can share
 * the SAME mutable object (imports resolve to one instance). Behavior unchanged.
 */
export interface ServerStats {
  totalHits: number;
  dailyHits: Map<string, number>;
  failedLogins: number;
  failedLoginIPs: { ip: string; time: number; username?: string }[];
  maintenanceMode: boolean;
  featureFlags: { doctorAI: boolean; navBharatPro: boolean; appBuilder: boolean };
  pricingConfig: { coinsPerRupee: number; referralBonusPct: number };
  providerEnabled: { gemini: boolean; anthropic: boolean; grok: boolean; vertex: boolean };
  announcements: { id: string; message: string; createdAt: string; target: 'all' | string }[];
}

/**
 * The DEFAULTS, as a factory.
 *
 * WHY A FACTORY AND NOT JUST THE OBJECT (2026-08-06). `serverStats` is a process-wide MUTABLE singleton
 * that routes legitimately write to — `totalHits` climbs on every request, `failedLogins` on every bad
 * password. A test asserting `serverStats.totalHits === 0` is therefore asserting a fact about global
 * state AT AN ARBITRARY MOMENT, which is only true if that test happens to run before anything else in
 * the process. It did, until file order shuffled — then it failed, intermittently, in a suite of 12,000
 * where the cause looks like anything but "another file made a request". That is untestable by
 * construction, not a flaky test.
 *
 * The defaults are a fact about the SHAPE, so they get their own fresh object and can be asserted
 * honestly. Nested values are rebuilt per call — a shared Map or array would hand every caller the same
 * mutable instance and reintroduce exactly the coupling this removes.
 */
export function defaultServerStats(): ServerStats {
  return {
    totalHits: 0,
    dailyHits: new Map<string, number>(),
    failedLogins: 0,
    failedLoginIPs: [],
    maintenanceMode: false,
    featureFlags: { doctorAI: true, navBharatPro: true, appBuilder: true },
    pricingConfig: { coinsPerRupee: 100, referralBonusPct: 10 },
    providerEnabled: { gemini: true, anthropic: true, grok: true, vertex: true },
    announcements: [],
  };
}

/** The one shared instance every route mutates. Starts from the defaults above. */
export const serverStats: ServerStats = defaultServerStats();
