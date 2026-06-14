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

export const serverStats: ServerStats = {
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
