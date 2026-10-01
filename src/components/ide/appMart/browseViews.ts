// App Mart Browse — which apps each view shows, and which shelves each filter keeps (admin 2026-10-01:
// "browser me 3 button hi bana do — 1. general 2. follower 3. likes app … sabhi page me upar play
// instantly aur apk filter bhi add karo"). Pure, so every rule is tested (tests/appMartSocialPhase2.test.ts).
//
//  • General   — every app on App Mart (what Browse always showed).
//  • Following — apps by creators the viewer follows, newest first.
//  • Liked     — apps the viewer pressed 👍 on, most recently liked first. Private to them.
//
// The filter row — All · Play instantly · APK — sits above all three views and keeps one shelf or both.
// 🍎 On an iPhone the row is not drawn at all: an `.apk` cannot install there, so "APK" would be a
// dead choice and "All" and "Play instantly" would be the same list twice (appStoreCompliance.ts).

export type BrowseView = 'general' | 'following' | 'liked';
export type KindFilter = 'all' | 'web' | 'apk';

export const BROWSE_VIEWS: ReadonlyArray<{ id: BrowseView; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'following', label: 'Following' },
  { id: 'liked', label: 'Liked apps' },
];

const ALL_KIND_FILTERS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'web', label: 'Play instantly' },
  { id: 'apk', label: 'APK' },
];

/** The filter chips to draw. Empty on Apple hardware, where the row is hidden. */
export function kindFilterOptions(hideAndroid: boolean): ReadonlyArray<{ id: KindFilter; label: string }> {
  return hideAndroid ? [] : ALL_KIND_FILTERS;
}

/** Which shelves a filter keeps. Android is never shown where it cannot install, whatever the filter. */
export function shelvesFor(filter: KindFilter, hideAndroid: boolean): { web: boolean; apk: boolean } {
  if (hideAndroid) return { web: true, apk: false };
  return { web: filter !== 'apk', apk: filter !== 'web' };
}

/** A personal view needs a signed-in person; General does not. */
export function viewNeedsSignIn(view: BrowseView): boolean {
  return view !== 'general';
}

/**
 * What an EMPTY view says — specific to why it is empty, never a generic "nothing here". `followingCount`
 * is how many creators the viewer follows (null when unknown), so "you follow nobody" and "the people you
 * follow have no apps of this kind" are told apart.
 */
export function emptyViewMessage(input: {
  view: BrowseView; filter: KindFilter; signedIn: boolean; followingCount: number | null;
}): { title: string; hint: string } {
  const kind = input.filter === 'web' ? 'instant apps' : input.filter === 'apk' ? 'Android apps' : 'apps';
  if (input.view === 'following') {
    if (!input.signedIn) return { title: 'Sign in to see apps from creators you follow.', hint: 'Follow a creator from their profile, and their apps collect here.' };
    if (input.followingCount === 0) return { title: 'You do not follow anyone yet.', hint: 'Open General, tap a creator’s name, and press Follow. Their apps will show up here.' };
    return { title: `The creators you follow have no ${kind} yet.`, hint: 'New apps from them will appear here first.' };
  }
  if (input.view === 'liked') {
    if (!input.signedIn) return { title: 'Sign in to see the apps you liked.', hint: 'Press 👍 on any app and it is saved here. Only you can see this list.' };
    return { title: input.filter === 'all' ? 'You have not liked any apps yet.' : `You have not liked any ${kind} yet.`, hint: 'Press 👍 on an app and it is saved here. Only you can see this list.' };
  }
  return { title: `No ${kind} on App Mart yet.`, hint: 'Build something in NavBharatAI Pro and publish it here.' };
}
