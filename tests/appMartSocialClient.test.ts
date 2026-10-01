// App Mart social — the client half (admin 2026-09-30). The formatting helpers are tested directly;
// the wiring (the bar under BOTH shelves, comments in BOTH sheets, a notification tap that lands on the
// app) is tested against the source, because each is broken by deleting a line, which no render of
// today's screen would notice.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compactCount, timeAgo, initialOf, optimisticReact } from '../src/components/ide/appMart/socialFormat';
import { nextReaction } from '../src/server/lib/appMartSocialRules';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
/** Source without comments — a file's own explanation quotes what it refuses to do. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('numbers and times', () => {
  it('writes counts the way every social app does', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1234)).toBe('1.2K');
    expect(compactCount(12_999)).toBe('12.9K');
    expect(compactCount(250_000)).toBe('250K');
    expect(compactCount(1_550_000)).toBe('1.5M');
    expect(compactCount(-3)).toBe('0');
    expect(compactCount(undefined)).toBe('0');
    expect(compactCount(Number.NaN)).toBe('0');
  });
  it('says how long ago', () => {
    const now = 10_000_000_000;
    expect(timeAgo(now - 5_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d');
    expect(timeAgo(0, now)).toBe('');
  });
  it('draws a letter when there is no photo', () => {
    expect(initialOf('asha')).toBe('A');
    expect(initialOf('  ')).toBe('?');
  });
});

describe('the number moves the moment you press — and agrees with the server', () => {
  const zero = { likes: 5, dislikes: 2, comments: 1 };
  it('like, unlike, switch', () => {
    expect(optimisticReact(zero, null, 'like')).toEqual({ counts: { likes: 6, dislikes: 2, comments: 1 }, mine: 'like' });
    expect(optimisticReact(zero, 'like', 'like')).toEqual({ counts: { likes: 4, dislikes: 2, comments: 1 }, mine: null });
    expect(optimisticReact(zero, 'like', 'dislike')).toEqual({ counts: { likes: 4, dislikes: 3, comments: 1 }, mine: 'dislike' });
    expect(optimisticReact({ likes: 0, dislikes: 0, comments: 0 }, 'dislike', 'dislike').counts.dislikes).toBe(0);
  });
  it('uses the SAME toggle as the server, so the guess is never contradicted', () => {
    for (const mine of [null, 'like', 'dislike'] as const) {
      for (const pressed of ['like', 'dislike'] as const) {
        expect(optimisticReact(zero, mine, pressed).mine).toBe(nextReaction(mine, pressed));
      }
    }
  });
});

describe('🔒 the wiring', () => {
  const store = read('src/components/ide/NavAppStore.tsx');
  const ui = read('src/components/ide/appMart/AppMartSocial.tsx');
  const bell = read('src/components/NotificationBell.tsx');

  it('the 👍 · 👎 · 💬 bar sits under BOTH shelves — instant apps and Android apps', () => {
    expect(store).toContain('onReact={(r) => void social.press(webKey(a.id), r)}');
    expect(store).toContain('onReact={(r) => void social.press(apkKey(a.id), r)}');
  });

  it('comments open in BOTH detail sheets, and the creator reaches the likers list from there', () => {
    expect(store).toContain('appKey={webKey(detailApp.id)}');
    expect(store).toContain('appKey={apkKey(openApp.id)}');
    expect(store.match(/onOpenLikers=\{/g)?.length).toBe(2);
  });

  it('there is no dislikers screen anywhere in the client', () => {
    expect(code(ui)).not.toMatch(/dislikers|DislikersSheet/i);
    expect(ui).toContain('Dislikes are private: you see how many, never who.');
  });

  it('every comment offers report and block, and the admin has a queue', () => {
    expect(ui).toContain('Report comment');
    expect(ui).toContain('Block {c.author.name}');
    expect(store).toContain('<CommentReportsAdmin');
  });

  it('a commenter’s name opens their profile, and the profile never draws an email', () => {
    expect(ui).toContain('onOpen!(person.creatorId)');
    expect(code(ui)).not.toMatch(/\.email\b/);
  });

  it('a tapped App Mart notification lands on that app, following only an App Mart key', () => {
    expect(bell).toContain("n.action === 'open-app-mart' && n.target && APP_MART_TARGET.test(n.target)");
    expect(bell).toContain("detail: { view: 'appstore', storeSocialKey: target }");
    expect(read('src/App.tsx')).toContain('setStoreSocialTarget({ key: detail.storeSocialKey, nonce: Date.now() })');
    expect(read('src/components/panels/ViewPanels.tsx')).toContain('socialTarget={storeSocialTarget}');
  });

  it('an iPhone never lists an .apk on a profile', () => {
    expect(store).toContain('hideAndroid={HIDE_ANDROID_INSTALLS}');
    expect(ui).toContain("!(hideAndroid && a.kind === 'apk')");
  });
});
