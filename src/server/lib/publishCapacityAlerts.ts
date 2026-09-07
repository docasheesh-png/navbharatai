/**
 * PUBLISH-CAPACITY ALERTING — the follow-on ROADMAP §10.3 step 1 named for itself.
 *
 * The Publish Capacity panel made the ceiling visible. This makes it *noticed*. The failure it guards
 * is the worst shape a limit can have — publishing stops for EVERY user at once, with nothing in the
 * product hinting it was coming — and a warning that only appears on a screen somebody has to think to
 * open is not really a warning.
 *
 * ═══ WHY THIS IS NOT SIMPLY "CALL THE INVENTORY IN THE SWEEP" ═══
 *
 * The sweep runs every 15 minutes, in every live Cloud Run instance. Reading the inventory means one
 * Firebase Hosting API call PLUS a Firestore read of up to 500 deployment records — four times an hour
 * per instance, to answer a question whose answer moves one publish at a time. So the probe gets its
 * own, much slower cadence.
 *
 * 🔒 AND THAT IS EXACTLY WHERE THE OBVIOUS IMPLEMENTATION IS WRONG. In this alerting model, an alert
 * that is ABSENT from a sweep is treated as RESOLVED and the admin is sent a green all-clear. So a
 * probe that is merely skipped — or that failed — would announce "publish capacity is back within its
 * normal range" without anything having been measured. That is the same dishonesty as drawing a zero
 * line over a dead feed, and it would arrive at the precise moment the number was least trustworthy.
 *
 * Hence the rule this module exists to enforce: **the cache holds the last SUCCESSFUL probe, and it is
 * re-emitted unchanged until another probe SUCCEEDS.** A failed or skipped probe changes nothing. The
 * alert can therefore only ever be resolved by a measurement that actually saw the ceiling clear.
 *
 * The accepted cost of that choice, stated rather than discovered: if probes fail indefinitely after a
 * warning, the warning persists. That is the correct side to fail on — a stuck warning is visibly
 * wrong and prompts a look, while a false all-clear is invisibly wrong and stops anyone looking.
 *
 * The decision half is pure and unit-tested; only `probeCapacity` touches the network.
 */
import type { MetricAlert } from './metricsAlerts';

/** The last SUCCESSFUL probe. `alert: null` means "measured, and the platform is fine". */
export interface CapacityProbe {
  at: number;
  alert: MetricAlert | null;
}

/** How often the inventory is genuinely re-read. Slow on purpose — see the header. */
export function capacityProbeIntervalMs(): number {
  const raw = Number(process.env.MONITOR_CAPACITY_PROBE_MINUTES);
  const mins = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 60, Math.max(15, Math.floor(raw))) : 60;
  return mins * 60_000;
}

/** Is capacity alerting on at all? Default yes; `off` is a real, instant kill switch. */
export function capacityAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MONITOR_CAPACITY_ALERTS ?? '').trim().toLowerCase() !== 'off';
}

/** Time to spend a real probe? Pure. */
export function shouldProbeCapacity(
  cache: CapacityProbe | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!cache) return true;
  return nowMs - cache.at >= intervalMs;
}

/**
 * What this sweep should report, given the cache. Pure.
 *
 * Never empties the alert on its own: only a fresh successful probe that found the platform healthy
 * can clear it, because only that is a measurement. See the header for why the alternative is worse.
 */
export function capacityAlertsFrom(cache: CapacityProbe | null): MetricAlert[] {
  if (!cache || !cache.alert) return [];
  return [cache.alert];
}

/** Module-level cache. Per-instance, which is fine: the alert STATE is shared and transactional. */
let cache: CapacityProbe | null = null;

/** Test seam. */
export function __setCapacityCache(next: CapacityProbe | null): void { cache = next; }
export function __getCapacityCache(): CapacityProbe | null { return cache; }

/**
 * Read the real inventory and turn it into an alert, or null when nothing can be measured.
 *
 * 🔒 A FAILED READ RETURNS NULL AND IS NOT CACHED. An unreadable channel list is not "zero channels in
 * use" — the inventory endpoint already refuses to report a made-up all-clear for exactly this reason,
 * and an alerting path must hold the same line.
 *
 * The imports are dynamic so the alert sweep does not drag the Hosting deployer (and google-auth-library
 * with it) into every process that merely imports the alerting module.
 */
export async function probeCapacity(): Promise<MetricAlert | null | undefined> {
  try {
    const [{ FirebaseHostingDeployer }, { deploymentStore }, { classifyChannels, channelCeilingVerdict, publishCapacityAlert }] =
      await Promise.all([
        import('../AgentV3/Deployment'),
        import('../AgentV3/DeploymentStore'),
        import('../AgentV3/channelInventory'),
      ]);
    const [chan, reg] = await Promise.all([
      new FirebaseHostingDeployer().listChannelsWithCompleteness(),
      deploymentStore.listWithCompleteness({ limit: 500 }),
    ]);
    const verdict = channelCeilingVerdict(classifyChannels(chan.channels, reg.records, reg.complete));
    return publishCapacityAlert(verdict);
  } catch {
    // `undefined` = the probe did not happen. Distinct from `null`, which means "measured, all clear"
    // and is the ONLY thing allowed to clear a standing alert.
    return undefined;
  }
}

/**
 * The `extraAlerts` source the sweep calls. Probes at most once per interval; otherwise re-emits what
 * was last actually measured. Never throws.
 */
export async function capacityExtraAlerts(now: () => number = Date.now): Promise<MetricAlert[]> {
  if (!capacityAlertsEnabled()) return [];
  const nowMs = now();
  if (shouldProbeCapacity(cache, nowMs, capacityProbeIntervalMs())) {
    const probed = await probeCapacity();
    // Only a probe that genuinely completed updates the cache — including the healthy `null` result,
    // which is what legitimately resolves a standing alert.
    if (probed !== undefined) cache = { at: nowMs, alert: probed };
  }
  return capacityAlertsFrom(cache);
}
