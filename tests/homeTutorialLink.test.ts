import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const home = read('src/components/home/HomeView.tsx');
const native = read('src/lib/mobileNative.ts');
const kb = read('src/server/AppContext/AppKnowledgeBase.ts');


/**
 * The file's UI TEXT only — comments stripped.
 *
 * The language rule is about what a USER reads. A comment may quote the Hinglish phrasing it is
 * explaining (and this one's does), so a whole-file scan would fail on the explanation instead of on
 * the label. Deliberately crude: it only has to be right about this one file.
 */
function strippedUiText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

describe('the "how to build an app" help on the Home page', () => {
  it('points at the right video, without the share-tracking token', () => {
    // The URL as given carried `?si=…`, which identifies the admin's own share session and would have
    // travelled to every user for no benefit.
    const line = home.split('\n').find((l) => l.includes('HOW_TO_BUILD_VIDEO_URL ='))!;
    expect(line).toContain('https://youtu.be/bUG33GYzeHc');
    // Scoped to the constant itself: the comment above it names `?si=` to explain the removal, and a
    // whole-file ban would fail on the explanation rather than on the thing being explained.
    expect(line).not.toContain('?si=');
  });

  it('is ONE tap — no intermediate popup whose only content is another button', () => {
    // Asked for as "i" → popup → button → video. The video is the whole feature; a confirmation step
    // in front of it only asks the user whether they meant the thing they just tapped.
    const at = home.indexOf('HOW_TO_BUILD_VIDEO_URL');
    expect(at).toBeGreaterThan(-1);
    expect(home).toContain('onClick={() => openExternalUrl(HOW_TO_BUILD_VIDEO_URL)}');
  });

  it('sits ABOVE the card grid, where it is about the whole page rather than one tile', () => {
    const strip = home.indexOf('Stuck building your app?');
    const grid = home.indexOf('Product Cards (4:');
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(grid);
  });

  it('THE LABEL IS PROFESSIONAL ENGLISH — this shipped as Hinglish and should not have', () => {
    // CLAUDE.md's language standard: every UI label, button, message and tooltip in NavBharatAI is
    // professional English. The single exception is AI-GENERATED reply text inside a chat bubble.
    // This is a product label, so the exception does not reach it. The first version read
    // "App banane me dikkat aa rahi hai?" — caught by the admin, not by this file, which is why the
    // rule is now asserted here rather than remembered.
    expect(home).toContain('Stuck building your app?');
    expect(home).toContain('Watch a short video on how to build one');
    for (const hinglish of ['banane', 'dikkat', 'rahi hai', 'kaise', 'karo', 'nahi']) {
      expect(strippedUiText(home).toLowerCase()).not.toContain(hinglish);
    }
  });

  it('can be hidden — but NEVER permanently lost', () => {
    // A help link that can be deleted for good is a help link that eventually is. Dismissing collapses
    // it to a chip that still opens the same video.
    expect(home).toContain('nbai_home_tutorial_dismissed');
    expect(home).toContain('How to build an app');            // the collapsed chip
    const opens = home.split('openExternalUrl(HOW_TO_BUILD_VIDEO_URL)').length - 1;
    expect(opens).toBe(2);                                     // full strip AND collapsed chip
  });

  it('never lets storage break the page — private mode throws on read AND write', () => {
    expect(home).toContain('function readTutorialDismissed');
    expect(home).toContain('function writeTutorialDismissed');
    const helpers = home.slice(home.indexOf('function readTutorialDismissed'), home.indexOf('interface HomeData'));
    expect((helpers.match(/catch/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('is reachable by keyboard and by a screen reader', () => {
    expect(home).toContain('aria-label="Watch the video: how to build your first app with NavBharatAI Pro"');
    // Real buttons, and the dismiss is a SIBLING — a button inside a button is invalid HTML and the
    // inner one stops being reachable.
    expect(home).not.toMatch(/<button[^>]*>\s*<button/);
  });
});

describe('openExternalUrl — one opener, safe by construction', () => {
  it('hands the URL to the OS in the native shell, so a video opens in the video app', () => {
    expect(native).toContain("window.open(parsed.href, '_system')");
    expect(native).toContain('isNativeApp()');
  });

  it('cannot be talked into running a script URL', () => {
    expect(native).toContain("parsed.protocol !== 'https:' && parsed.protocol !== 'http:'");
  });

  it('cuts the opened page off from window.opener on the web', () => {
    expect(native).toContain("'noopener,noreferrer'");
  });
});

describe('every AI in NavBharatAI can point a stuck user at it', () => {
  it('the knowledge base carries the entry, with the words a user would really type', () => {
    // CLAUDE.md: a feature not in AppKnowledgeBase is invisible to every assistant in the product —
    // and "app nahi ban rahi" is precisely the sentence that should surface this.
    expect(kb).toContain("id: 'how_to_build_video'");
    for (const word of ['app nahi ban rahi', 'kaise banaye', 'sikhao', 'dikkat']) {
      expect(kb).toContain(word);
    }
  });
});
