// The production wiring of the reporter: the Crashlytics plugin inside the phone app, and our own log
// endpoint everywhere. Kept apart from `index.ts` so the reporter's logic is testable without Capacitor.

import type { CrashlyticsSink, ObservabilityDeps } from './index';
import { offlineQueue } from '../offlineQueue';

/**
 * The plugin is used through plain functions that close over it. A function that RESOLVED to the plugin
 * proxy would make a native call named `then` and never settle — the class
 * `tests/pluginProxyIsNeverResolved.test.ts` exists to stop (see appCheckClient.ts).
 */
export async function loadNativeCrashlytics(): Promise<CrashlyticsSink | null> {
  const [{ Capacitor }, { FirebaseCrashlytics }] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor-firebase/crashlytics'),
  ]);
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('FirebaseCrashlytics')) return null;
  return {
    recordException: (report, frames) => FirebaseCrashlytics.recordException({
      message: `[${report.kind}] ${report.message}`,
      // Android carries per-report keys here; iOS ignores them when a stack trace is given, so the
      // same values are ALSO set as app-level keys by setAppContext/setFeatureContext.
      keysAndValues: Object.entries({ ...report.keys, feature_area: report.area }).map(([key, value]) => ({
        key,
        value,
        type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'double' : 'string',
      })),
      stacktrace: frames.length > 0 ? frames : undefined,
    }),
    setUserId: (id) => FirebaseCrashlytics.setUserId({ userId: id }),
    setCustomKey: (key, value) => FirebaseCrashlytics.setCustomKey({
      key,
      value,
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'double' : 'string',
    }),
    log: (message) => FirebaseCrashlytics.log({ message }),
    crash: (message) => FirebaseCrashlytics.crash({ message }),
  };
}

/** The dependencies the app runs the reporter with. */
export function productionObservabilityDeps(): ObservabilityDeps {
  return {
    enabled: import.meta.env.PROD,
    postLog: (body) => { void offlineQueue.postWithFallback('/api/logs/error', body); },
    loadCrashlytics: loadNativeCrashlytics,
    now: () => Date.now(),
  };
}
