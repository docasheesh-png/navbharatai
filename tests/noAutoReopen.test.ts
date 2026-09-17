import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const at = (p: string) => join(process.cwd(), p);
const read = (p: string) => readFileSync(at(p), 'utf8');

/**
 * ⛔ PR #2996 IS NOW REVERTED IN FULL (admin 2026-09-17). DO NOT REBUILD IT.
 *
 * *"yar aap is pure PR ko hi hata do! mujhe nahi chahiye. jab bhi page reload hota hai, navbharatai
 * chat open ho jati hai. mai setting me kam kar raha hu, reload kiya, navbharatai chat open ho gayi.
 * hatao isko. mujhe yeh pura kaam reverse kar ke do!!"*
 *
 * 🔴 WHY THE WHOLE THING, AND NOT A NARROWER FIX. The admin's original request was about ONE screen:
 * open a CHAT, and find it where you left it. #2996 turned that into an app-wide LANDING rule that
 * ran on every reload from ANY screen — so working in Settings and pressing reload took the user to a
 * chat. That is the feature behaving exactly as designed, which is the point: a reload is not a
 * request to go somewhere else. Somebody reloading in Settings is trying to reload Settings. No
 * exclusion list fixes a rule aimed at the wrong event.
 *
 * ⚠️ AND THIS IS THE SECOND REMOVAL. #3007 took off the home-screen half and KEPT the reopen, on the
 * reading that the reopen was what had been asked for. It was not. A revert leaves NO failing test
 * behind, so nothing would have noticed either half surviving — which is exactly what happened.
 * This file is that missing signal.
 */
describe('nothing decides where a reload lands', () => {
  const GONE = [
    'src/lib/lastPlace.ts',
    'src/lib/freeChatResume.ts',
    'src/lib/recentConversations.ts',
    'src/components/home/RecentConversations.tsx',
  ];

  it('every module #2996 added is gone', () => {
    for (const f of GONE) expect(existsSync(at(f)), `${f} should not exist`).toBe(false);
  });

  it('🔴 THE REPORTED BUG: no landing decision runs at start-up', () => {
    // These are the names that chose a screen FOR the user. If any returns, a reload can once again
    // take somebody out of the screen they were working in.
    const app = read('src/App.tsx');
    for (const symbol of ['decideLanding', 'readLastPlace', 'recordLastPlace', 'pickFreeChatResume', 'lastPlace', 'freeChatResume']) {
      expect(app, `${symbol} is back — a reload can hijack the current screen again`).not.toContain(symbol);
    }
  });

  it('the Free chat opens as a NEW conversation, not a restored one', () => {
    // The resume also carried the previous session's id back. Restoring the transcript without it
    // duplicated the conversation on every refresh, so both halves must stay gone together.
    const app = read('src/App.tsx');
    expect(app).toContain('const [currentSessionId, setCurrentSessionId] = useState<string>(() => Date.now().toString());');
    expect(app).not.toContain('freeResumeRef');
    expect(app).not.toContain('bootFreeChatMessages');
  });

  it('Home renders no recent-conversations section', () => {
    const home = read('src/components/home/HomeView.tsx');
    expect(home).not.toContain('Continue where you left off');
    expect(home).not.toContain('onOpenRecent');
  });

  it('the knowledge base promises neither behaviour', () => {
    // Left in place, every AI in the product would keep confidently describing a feature that is
    // gone — the stale-capability class this repo has now paid for three times in one week.
    const akb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(akb).not.toContain('YOU COME BACK TO WHERE YOU LEFT OFF');
    expect(akb).not.toContain('YOUR CONVERSATIONS ARE ON THE HOME SCREEN');
  });

  it('🔒 the OTHER PR that shared those lines survived', () => {
    // "Your published apps are on your profile" shipped separately and sits in the same region of the
    // knowledge base. A careless revert would have deleted a live feature's only description, and
    // nothing else would have failed.
    const akb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(akb).toContain('YOUR PUBLISHED APPS ARE ON YOUR PROFILE');
  });
});
