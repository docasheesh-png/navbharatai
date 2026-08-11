// The Capacitor ↔ Android toolchain matrix — ONE governed source of truth (audit 2026-08-11, G2).
//
// WHY THIS EXISTS: three places used to decide "which Capacitor / which Java" independently, and they had
// silently drifted apart:
//   • mobileProjectAssembler.ts pinned the DEFAULT Capacitor major to 6,
//   • MobileExportGenerator.ts declared the dependency as `^6`,
//   • both APK/AAB workflows hardcoded `java-version: '21'`.
// Capacitor 6's Android project ships Gradle 8.2.1 and OFFICIALLY wants JDK 17 — so "default Capacitor 6
// built on Java 21" was a combination nobody validated (it happened to work, which is worse than failing:
// it hid the mismatch). And a repair that only ever bumped Java "up to 21" could push a Capacitor-6 app
// onto a Java its Gradle doesn't officially support.
//
// The fix is not another patch — it is to make the *class* impossible: every consumer now reads the major →
// toolchain mapping from THIS table, and a co-validation test asserts the workflow's Java equals what the
// default major requires, so the two can never drift again. When Capacitor ships a new major, add ONE row
// here and the assembler, the export generator, the workflow Java pin and the repair all move together.
//
// Sources: Capacitor "Android environment setup" + each major's release/upgrade notes. Kept deliberately
// small — only the majors NavBharatAI actually generates or accepts.
//
// Pure and unit-tested: no network, no filesystem.

export interface CapacitorToolchain {
  /** The Capacitor major this row governs. */
  major: number;
  /** JDK major the Android build needs — drives setup-java's `java-version`. */
  java: number;
  /** The Android `minSdkVersion` floor this Capacitor line assumes. */
  minSdk: number;
  /** The Android `compileSdkVersion` this Capacitor line targets. */
  compileSdk: number;
}

// Ordered oldest → newest. `toolchainForMajor` relies on this ordering for its forward-safe fallback.
export const CAPACITOR_TOOLCHAINS: readonly CapacitorToolchain[] = [
  { major: 5, java: 17, minSdk: 22, compileSdk: 34 },
  { major: 6, java: 17, minSdk: 22, compileSdk: 34 },
  { major: 7, java: 21, minSdk: 23, compileSdk: 35 },
  { major: 8, java: 21, minSdk: 23, compileSdk: 35 },
] as const;

// The Capacitor line NavBharatAI adds when the app expresses no preference of its own. Chosen so the Java
// the workflow already pins (21) is the OFFICIALLY-correct Java for this major — the two are co-validated
// by capacitorToolchain.test.ts, never independently guessed.
export const DEFAULT_CAPACITOR_MAJOR = 7;

/**
 * The governed toolchain for a Capacitor major.
 *
 * Forward-safe by construction:
 *   • exact row when the major is known,
 *   • else the NEWEST row at or below it (a brand-new Capacitor 9 uses the latest known toolchain, never a
 *     stale one),
 *   • else — a major older than anything we list — the oldest row.
 * A missing/invalid major falls back to the governed default.
 */
export function toolchainForMajor(major: number | null | undefined): CapacitorToolchain {
  const m = typeof major === 'number' && Number.isFinite(major) && major > 0 ? major : DEFAULT_CAPACITOR_MAJOR;
  const exact = CAPACITOR_TOOLCHAINS.find((t) => t.major === m);
  if (exact) return exact;
  const atOrBelow = CAPACITOR_TOOLCHAINS.filter((t) => t.major <= m);
  if (atOrBelow.length) return atOrBelow[atOrBelow.length - 1]; // newest known ≤ m
  return CAPACITOR_TOOLCHAINS[0]; // older than every known major → oldest supported
}

/** Convenience: the Java major the default-generated workflow must pin. */
export function defaultToolchainJava(): number {
  return toolchainForMajor(DEFAULT_CAPACITOR_MAJOR).java;
}
