// THE LOAD BOARD — every ceiling in the platform, as one number a person can look at.
// (ROADMAP §12. Admin 2026-09-07: "admin panel ke home page par to load dikhna chahiye — server load,
// user load, storage load, hosting load… sabhi load likhne hai.")
//
// WHY IT EXISTS. §12's audit found eight ceilings, and every one of them is written with a TRIGGER —
// "when instances pin at 10", "when hosting reaches 80%", "when contention appears". A trigger nobody
// can see is not a trigger, it is a hope. This is the screen that turns each one into a number.
//
// 🔒 THE ONE RULE THAT MATTERS MORE THAN ANY THRESHOLD: **an unreadable number is UNKNOWN, never zero.**
// A board that prints "0" when it means "I could not tell" manufactures confidence at exactly the
// moment attention is needed — and this codebase has already paid for that mistake in three separate
// places (a channel inventory that read a Firestore hiccup as "no channels in use", a preview check
// that reported "Live!" over a site that was down, a metric gap that would have billed as "used
// nothing"). Every tile here carries `null` through to `unknown` rather than defaulting.
//
// PURE — readings in, tiles out. No I/O, no clock. The route gathers; this decides.

export type LoadLevel = 'ok' | 'warn' | 'critical' | 'full' | 'unknown';

export interface LoadTile {
  id: string;
  /** What the admin reads. Plain words, never a metric name. */
  label: string;
  level: LoadLevel;
  /** The measurement, or null when it could not be read. */
  value: number | null;
  /** The ceiling it is measured against, when one exists. */
  cap: number | null;
  /** e.g. "3 / 10 instances" — or "unknown" when it is. */
  display: string;
  /** What it means, and what to do when it is not ok. Always actionable, never just a status. */
  note: string;
}

export interface GradeInput {
  value: number | null | undefined;
  cap?: number | null;
  /** Fraction of the cap at which to warn. Default 0.8 — early enough to act. */
  warnAt?: number;
  /** Fraction at which it is critical. Default 0.9. */
  criticalAt?: number;
}

/**
 * Where one reading sits against its ceiling.
 *
 * 🔒 A null value is UNKNOWN and a null cap means "no ceiling to measure against", which is `ok` for a
 * real number — those are different situations and must not collapse. PURE.
 */
export function gradeLoad(input: GradeInput): LoadLevel {
  const v = input.value;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'unknown';
  const cap = input.cap;
  if (cap === null || cap === undefined || !Number.isFinite(Number(cap)) || Number(cap) <= 0) return 'ok';
  const n = Number(v);
  const c = Number(cap);
  if (n >= c) return 'full';
  const ratio = n / c;
  if (ratio >= (input.criticalAt ?? 0.9)) return 'critical';
  if (ratio >= (input.warnAt ?? 0.8)) return 'warn';
  return 'ok';
}

/** "3 / 10 instances", or an honest "unknown". PURE. */
export function displayOf(value: number | null | undefined, cap: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return `unknown ${unit}`.trim();
  const v = Number(value);
  const shown = Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (cap === null || cap === undefined || !Number.isFinite(Number(cap)) || Number(cap) <= 0) {
    return `${shown} ${unit}`.trim();
  }
  return `${shown} / ${cap} ${unit}`.trim();
}

/**
 * The WORST level on the board — what the home page shows as the single headline.
 *
 * 🔒 UNKNOWN NEVER MASKS A REAL PROBLEM, and it is never swallowed either. A critical tile beside an
 * unknown one is critical; an unknown tile beside only healthy ones is unknown, because "everything is
 * fine except the thing I could not read" is not "everything is fine". PURE.
 */
export function worstLevel(tiles: readonly Pick<LoadTile, 'level'>[] | null | undefined): LoadLevel {
  const list = tiles ?? [];
  if (list.length === 0) return 'unknown';
  const order: LoadLevel[] = ['full', 'critical', 'warn', 'unknown', 'ok'];
  for (const level of order) {
    if (list.some((t) => t.level === level)) return level;
  }
  return 'ok';
}

/** Everything the board can be told. Every field is optional — a reading we could not take is absent. */
export interface LoadReadings {
  /** Cloud Run instances of the PLATFORM, against `--max-instances` in cloudbuild.yaml (§12 #2). */
  instances?: number | null;
  instancesCap?: number | null;
  /** Requests currently in flight. */
  requestsInFlight?: number | null;
  /** Distinct users seen in the recent window. */
  activeUsers?: number | null;
  /** CPU as a fraction of the container's own limit, 0–1. */
  cpuFraction?: number | null;
  /** Memory as a fraction of the container's limit, 0–1. */
  memoryFraction?: number | null;
  /** Builds running right now. */
  buildsRunning?: number | null;
  /** Live E2B sandboxes. */
  sandboxesLive?: number | null;
  /** Firestore documents across the collections that grow (§12 #3). */
  storedDocuments?: number | null;
  /** How many of those collections have NO retention policy. */
  collectionsWithoutRetention?: number | null;
  /** Hosted Cloud Run services against the 1,000 cap (§12 #5). */
  hostedServices?: number | null;
  hostedServicesCap?: number | null;
  /** Publish channels against their cap (§10). */
  publishChannels?: number | null;
  publishChannelsCap?: number | null;
  /** Provider 429 rate over the window, 0–1 (§12 #8). */
  providerErrorRate?: number | null;
  /** Spend not recovered from users, in INR, over the window. */
  unrecoveredInr?: number | null;
}

const pct = (f: number | null | undefined): number | null =>
  f === null || f === undefined || !Number.isFinite(Number(f)) ? null : Math.round(Number(f) * 100);

/**
 * The board.
 *
 * Ordered by how soon each ceiling bites (§12's own ordering), not alphabetically — the first tile is
 * the one that fails first. Every note names the action, because a status with no action is a number
 * the admin has to go and interpret somewhere else. PURE.
 */
export function loadBoard(r: LoadReadings | null | undefined): LoadTile[] {
  const x = r ?? {};
  const tiles: LoadTile[] = [];

  // 1 · SERVER — the platform's own instance ceiling. §12 #2: this is ONE number in cloudbuild.yaml.
  const instLevel = gradeLoad({ value: x.instances, cap: x.instancesCap });
  tiles.push({
    id: 'server',
    label: 'Server load',
    level: instLevel,
    value: x.instances ?? null,
    cap: x.instancesCap ?? null,
    display: displayOf(x.instances, x.instancesCap, 'instances'),
    note: instLevel === 'unknown'
      ? 'Could not read how many servers are running. The number below is not zero — it is unmeasured.'
      : instLevel === 'ok'
        ? 'Servers are keeping up.'
        : 'Nearing the instance ceiling set in the deploy config (`_MAX_INSTANCES` in the Cloud Build '
          + 'trigger). Raising it costs nothing while idle — Cloud Run bills instances that actually run.',
  });

  // 2 · CPU + MEMORY of the container we are actually in.
  const cpuLevel = gradeLoad({ value: pct(x.cpuFraction), cap: 100 });
  tiles.push({
    id: 'cpu',
    label: 'CPU',
    level: cpuLevel,
    value: pct(x.cpuFraction),
    cap: 100,
    display: displayOf(pct(x.cpuFraction), 100, '%'),
    note: cpuLevel === 'unknown' ? 'CPU could not be read.' : 'Share of this server\'s own CPU limit.',
  });
  const memLevel = gradeLoad({ value: pct(x.memoryFraction), cap: 100 });
  tiles.push({
    id: 'memory',
    label: 'Memory',
    level: memLevel,
    value: pct(x.memoryFraction),
    cap: 100,
    display: displayOf(pct(x.memoryFraction), 100, '%'),
    note: memLevel === 'unknown' ? 'Memory could not be read.' : 'Share of this server\'s own memory limit.',
  });

  // 3 · USERS — no ceiling, so this is information, not a warning. A number with no cap must never be
  // graded as if it had one; that is how a healthy platform gets a red light for being popular.
  tiles.push({
    id: 'users',
    label: 'User load',
    level: gradeLoad({ value: x.activeUsers, cap: null }),
    value: x.activeUsers ?? null,
    cap: null,
    display: displayOf(x.activeUsers, null, 'active'),
    // 🔒 AN UNREAD TILE SAYS WHAT IT WOULD TAKE TO READ IT. "Unknown" with no next step is a tile the
    // admin learns to ignore, which is how a board full of grey becomes wallpaper.
    note: x.activeUsers === null || x.activeUsers === undefined
      ? 'Not measured here — the 24-hour active count is on the Business panel; a live figure needs a '
        + 'per-request user counter this route does not have.'
      : 'People using NavBharatAI right now. No ceiling — it is the other tiles that have limits.',
  });
  tiles.push({
    id: 'requests',
    label: 'Requests in flight',
    level: gradeLoad({ value: x.requestsInFlight, cap: null }),
    value: x.requestsInFlight ?? null,
    cap: null,
    display: displayOf(x.requestsInFlight, null, 'in flight'),
    note: 'Requests being served this instant. Sustained growth here is what pushes the instance count up.',
  });

  // 4 · BUILDS and SANDBOXES — a cost wall, not a server wall (§12 #7).
  tiles.push({
    id: 'builds',
    label: 'Build load',
    level: gradeLoad({ value: x.buildsRunning, cap: null }),
    value: x.buildsRunning ?? null,
    cap: null,
    display: displayOf(x.buildsRunning, null, 'building'),
    // ⚠️ PER-INSTANCE, AND IT SAYS SO. No process can count its siblings' builds, and several run at
    // once — presenting one instance's number as the platform's would understate exactly the load this
    // tile exists to show. Stated in the note rather than left for the admin to discover.
    note: x.buildsRunning === null || x.buildsRunning === undefined
      ? 'Not measured. Apps being built right now — each one holds a cloud machine while it runs.'
      : 'Apps being built right now ON THIS SERVER (several servers run at once). Each one holds a '
        + 'cloud machine while it runs.',
  });
  tiles.push({
    id: 'sandboxes',
    label: 'Sandbox load',
    level: gradeLoad({ value: x.sandboxesLive, cap: null }),
    value: x.sandboxesLive ?? null,
    cap: null,
    display: displayOf(x.sandboxesLive, null, 'live'),
    note: 'Live build machines. These are billed by the minute, so a number far above the builds above '
      + 'means machines are sitting idle.',
  });

  // 5 · STORAGE — the ceiling that never spikes and only ratchets (§12 #3).
  const noRetention = x.collectionsWithoutRetention ?? null;
  const storageLevel: LoadLevel = noRetention === null
    ? (x.storedDocuments === null || x.storedDocuments === undefined ? 'unknown' : 'ok')
    : noRetention > 0 ? 'warn' : 'ok';
  tiles.push({
    id: 'storage',
    label: 'Storage load',
    level: storageLevel,
    value: x.storedDocuments ?? null,
    cap: null,
    display: displayOf(x.storedDocuments, null, 'documents'),
    note: noRetention && noRetention > 0
      ? `${noRetention} collection(s) grow forever with no retention policy. Storage never spikes — it `
        + 'ratchets, and the bill arrives long after the decision. Turn the purge on and add one '
        + 'collection at a time, verifying each timestamp field first.'
      : 'Stored documents across the collections that grow.',
  });

  // 6 · HOSTING — 1,000 per project, and Google does not raise it (§12 #5).
  const hostLevel = gradeLoad({ value: x.hostedServices, cap: x.hostedServicesCap });
  tiles.push({
    id: 'hosting',
    label: 'Hosting load',
    level: hostLevel,
    value: x.hostedServices ?? null,
    cap: x.hostedServicesCap ?? null,
    display: displayOf(x.hostedServices, x.hostedServicesCap, 'apps hosted'),
    note: hostLevel === 'unknown'
      ? 'Could not read how many apps are hosted. Not zero — unmeasured.'
      : hostLevel === 'ok'
        ? 'Room for more hosted apps.'
        : 'Google does NOT raise this cap. The fix is a second apps project — start it now rather than '
          + 'at 999. Apps that are no longer live can be reclaimed first.',
  });

  // 7 · PUBLISH — §10's ceiling, solved by bucket-only publish but still worth watching.
  const pubLevel = gradeLoad({ value: x.publishChannels, cap: x.publishChannelsCap });
  tiles.push({
    id: 'publish',
    label: 'Publish load',
    level: pubLevel,
    value: x.publishChannels ?? null,
    cap: x.publishChannelsCap ?? null,
    display: displayOf(x.publishChannels, x.publishChannelsCap, 'channels'),
    note: pubLevel === 'ok' || pubLevel === 'unknown'
      ? 'Published sites holding a hosting channel.'
      : 'Approaching the channel ceiling. Bucket-only publishing takes no channel at all — that is the fix.',
  });

  // 8 · AI PROVIDERS — already handled in code; this is the tile that says whether it is still true.
  const aiPct = pct(x.providerErrorRate);
  const aiLevel: LoadLevel = aiPct === null ? 'unknown' : aiPct >= 20 ? 'critical' : aiPct >= 5 ? 'warn' : 'ok';
  tiles.push({
    id: 'ai',
    label: 'AI load',
    level: aiLevel,
    value: aiPct,
    cap: 100,
    display: aiPct === null ? 'unknown' : `${aiPct}% refused`,
    note: aiLevel === 'unknown'
      ? 'Could not read the provider refusal rate.'
      : aiLevel === 'ok'
        ? 'The AI engines are answering normally.'
        : 'Engines are refusing requests. At scale the answer is more API keys in rotation, not more code.',
  });

  // 9 · MONEY — the load that decides whether the rest is worth carrying.
  const money = x.unrecoveredInr ?? null;
  const moneyLevel: LoadLevel = money === null ? 'unknown' : money > 0 ? 'warn' : 'ok';
  tiles.push({
    id: 'money',
    label: 'Unrecovered spend',
    level: moneyLevel,
    value: money,
    cap: null,
    display: money === null ? 'unknown' : `₹${money.toFixed(2)}`,
    note: moneyLevel === 'unknown'
      ? 'Not measured yet — it needs our real AI + VM cost compared against what users were actually '
        + 'billed. The cost half is now real (see the Monitor); the comparison arrives with hosting metering.'
      : money && money > 0
        ? 'Spend not recovered from users in this window. Free-tier usage is deliberate; anything else is a leak.'
        : 'Every rupee spent in this window was recovered or deliberate.',
  });

  return tiles;
}
