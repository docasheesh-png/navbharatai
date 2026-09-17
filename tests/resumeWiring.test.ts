import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE WIRING — that App.tsx really uses the rules, and uses them in the one order that is safe.
 *
 * The rules themselves are pinned in `lastPlace.test.ts`, `freeChatResume.test.ts` and
 * `recentConversations.test.ts`. A pure module nothing calls is a module that passes its own tests
 * for ever while the feature does nothing — which is exactly the state `EmbeddingSearch` is in and
 * `CLAUDE.md` records as an open root cause.
 */

const app = readFileSync('src/App.tsx', 'utf8');
const home = readFileSync('src/components/home/HomeView.tsx', 'utf8');
const resume = readFileSync('src/lib/freeChatResume.ts', 'utf8');

/** Comments stripped — these assert what the CODE does, and several of the comments quote it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const appCode = code(app);

describe('the launch lands where the user left off', () => {
  it('the opening view consults the remembered place', () => {
    expect(appCode).toContain('bootLanding');
    expect(appCode).toMatch(/\(\(bootLanding\?\.view as ViewType\) \?\? 'home'\)/);
  });

  it('🔒 the URL still wins, in the order it always did', () => {
    // admin → store → the same-tab v5.0 reload flag → the remembered place. A remembered place that
    // could outrank /admin or a share link would have broken every link in the product.
    const at = appCode.indexOf("readAdminRoute() ? 'admin'");
    expect(at).toBeGreaterThan(0);
    const chain = appCode.slice(at, at + 260);
    expect(chain.indexOf('readStoreRoute')).toBeLessThan(chain.indexOf('readV3ViewFlag'));
    expect(chain.indexOf('readV3ViewFlag')).toBeLessThan(chain.indexOf('bootLanding'));
  });

  it('“the URL says something” is broad — any path, any query, any hash', () => {
    const at = appCode.indexOf('const hasExplicitDestination');
    expect(at).toBeGreaterThan(0);
    const fn = appCode.slice(at, at + 700);
    expect(fn).toContain('window.location.pathname');
    expect(fn).toContain('window.location.search');
    expect(fn).toContain('window.location.hash');
    // An unreadable URL counts as explicit: when in doubt, leave today's behaviour alone.
    expect(fn).toMatch(/catch \{ return true; \}/);
  });

  it('🔒 the boot decision is made with signedIn FALSE — Firebase has not answered yet', () => {
    const at = appCode.indexOf('const bootLanding');
    expect(at).toBeGreaterThan(0);
    const block = appCode.slice(at, at + 400);
    expect(block).toContain('signedIn: false');
  });

  it('…and a login-gated place is finished once auth really answers, ONCE', () => {
    expect(appCode).toContain('gatedLandingDoneRef');
    const at = appCode.indexOf('if (gatedLandingDoneRef.current) return;');
    expect(at).toBeGreaterThan(0);
    const block = appCode.slice(at, at + 700);
    expect(block).toContain('if (!user) return;');
    expect(block).toContain('signedIn: true');
    // Only while the user has not already gone somewhere themselves.
    expect(block).toContain("if (activeView !== 'home') return;");
  });

  it('the remembered place is read ONCE, before anything can overwrite it', () => {
    expect(appCode).toContain('const bootPlaceRef = useRef(readLastPlace(placeStore()));');
  });
});

describe('the free chat continues the SAME conversation', () => {
  it('the transcript and the session id both come from one answer', () => {
    expect(appCode).toContain('const freeResumeRef = useRef(');
    expect(appCode).toContain('pickFreeChatResume(');
    expect(appCode).toContain('nbi_chat: bootFreeChatMessages(),');
    expect(appCode).toMatch(/freeResumeRef\.current\?\.sessionId \?\? Date\.now\(\)\.toString\(\)/);
  });

  it('🔒 NEW CHAT does not reopen the old conversation', () => {
    // `initialNbiMessages` is what `startNewChat` is handed. Routing the resume through it would
    // make "New chat" reopen the conversation the user just left — the fake-button class.
    const at = appCode.indexOf('const initialNbiMessages');
    expect(at).toBeGreaterThan(0);
    // Its OWN body — bounded by its own closing brace. Slicing as far as the next declaration would
    // sweep in `freeResumeRef`, which legitimately sits between the two.
    const body = appCode.slice(at, appCode.indexOf('};', at) + 2);
    expect(body).not.toContain('freeResumeRef');
    expect(body).not.toContain('pickFreeChatResume');
    expect(appCode).toContain('initialFreeChatMessages: initialNbiMessages,');
  });

  it('a URL that already names a destination does not resume a conversation either', () => {
    const at = appCode.indexOf('const freeResumeRef');
    expect(appCode.slice(at, at + 260)).toContain('hasExplicitDestination()');
  });

  it('🔴 EVERY live message is carried back — the save effect writes the screen into the session', () => {
    // App.tsx: `messages: activeMsgs`. So a message dropped while resuming is deleted from the
    // user's saved conversation the next time they type. Only the already-collapsed older half,
    // which nothing rewrites, may be trimmed.
    expect(appCode).toContain('messages: activeMsgs,');
    const body = code(resume);
    expect(body).toContain('const all = [...older.slice(-RESUME_VISIBLE_MESSAGES), ...live];');
    expect(body).not.toMatch(/all\.slice\(-RESUME_VISIBLE_MESSAGES\)/);
  });
});

describe('the place is remembered', () => {
  it('recorded on every view change, with the guard left to the module', () => {
    const at = appCode.indexOf('recordLastPlace(');
    expect(at).toBeGreaterThan(0);
    const block = appCode.slice(at - 400, at + 700);
    expect(block).toContain('view: activeView,');
    expect(block).toContain('RESUMABLE_PROFESSIONALS');
    // No allow-list at the call site — that decision has exactly one address.
    expect(block).not.toMatch(/activeView === 'nbi_chat' \|\| activeView === 'nbi_pro_chat' \?/);
  });

  it('🔒 the resumable set comes from the REGISTRY, never a pattern', () => {
    // `other_ai` is the builder-tools hub and matches any `_ai` test.
    expect(appCode).toContain('Object.keys(PROFESSIONAL_CHATS)');
    expect(appCode).toContain('PROFESSIONALS_IMPLEMENTED_ELSEWHERE');
    expect(appCode).not.toMatch(/RESUMABLE_PROFESSIONALS[\s\S]{0,120}\/_ai\$?\//);
  });
});

/**
 * ⛔ REMOVED 2026-09-17, on the admin's instruction: *"homepage se isko pura hatao"*.
 *
 * This describe block asserted a "Continue where you left off" LIST on the home screen. The admin's
 * actual request had been the OTHER half of that change — that opening NavBharatAI Free or Pro puts
 * you back in your last conversation where you left it — and the home-screen list was an addition
 * nobody asked for. The reopen behaviour is untouched and is still covered by every test above.
 *
 * The removal is recorded here rather than deleted silently, so a later session reading the git
 * history does not "restore" a feature that was taken out on purpose.
 */
