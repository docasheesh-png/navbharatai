// Where an App Mart notification leads — ONE grammar, read by the server that writes the target and by
// every client surface that follows it (the bell, a tapped phone push, App Mart itself).
//
// It used to be a regex copied into the bell (`/^(web|apk):…$/`), with the push handler following
// nothing at all, so a tapped push opened the app on Home. With follows there is a second kind of
// target (a person's followers), and a second copy of the grammar would drift from the first the day
// a third kind is added. So: one parser, pure, tested in tests/appMartSocialPhase2.test.ts.
//
//   web:<id> / apk:<id>   — open that app, on its comments
//   profile:<creatorId>   — open a person's public profile (`me` is the viewer's own)
//   followers:me          — open the viewer's own profile with the followers list
//
// 🔒 Nothing else is followed. A target is data that came back from a server or out of a push payload,
// so anything that does not match is ignored rather than guessed at.

export type AppMartTarget =
  | { type: 'app'; kind: 'web' | 'apk'; id: string; key: string }
  | { type: 'profile'; creatorId: string }
  | { type: 'followers' };

const APP = /^(web|apk):([A-Za-z0-9_-]{4,80})$/;
const PROFILE = /^profile:(me|[0-9a-z]{10})$/;

export function parseAppMartTarget(raw: unknown): AppMartTarget | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 100) return null;
  const app = APP.exec(s);
  if (app) return { type: 'app', kind: app[1] as 'web' | 'apk', id: app[2], key: s };
  const profile = PROFILE.exec(s);
  if (profile) return { type: 'profile', creatorId: profile[1] };
  if (s === 'followers:me') return { type: 'followers' };
  return null;
}

export function isAppMartTarget(raw: unknown): boolean {
  return parseAppMartTarget(raw) !== null;
}

/** The target every follower notification carries. */
export const FOLLOWERS_TARGET = 'followers:me';

/**
 * What a tapped phone notification should do, decided from its data payload. PURE, so the rule is
 * tested without a device. `null` means "just bring the app forward", which is what any payload we do
 * not recognise gets.
 */
export type PushTapAction =
  | { kind: 'open-url'; url: string }
  | { kind: 'open-app-mart'; target: string };

export function pushTapAction(data: Record<string, unknown> | null | undefined, fallbackStoreUrl: string): PushTapAction | null {
  const d = data ?? {};
  if (String(d.action ?? '') === 'open_store') {
    const url = typeof d.storeUrl === 'string' && /^https?:\/\//.test(d.storeUrl) ? d.storeUrl : fallbackStoreUrl;
    return { kind: 'open-url', url };
  }
  if (String(d.type ?? '') === 'app-mart') {
    // `target` is the new field; `appKey` is what the first App Mart pushes carried (2026-09-30).
    const target = typeof d.target === 'string' && d.target ? d.target : d.appKey;
    if (isAppMartTarget(target)) return { kind: 'open-app-mart', target: String(target).trim() };
  }
  return null;
}
