/**
 * AUTOPSY `0d297b25` (2026-09-23), the open root cause #3277 named: a request about an app that is NOT
 * in the workspace was BUILT rather than answered.
 *
 * "The WORKNEX app is already developed in this Replit project. DO NOT rebuild it from scratch …"
 * reached a workspace holding only our starter, and a four-minute build found out what the message and
 * the workspace already said. And the same sentence read as an EXPLICIT fresh-start order, because
 * `wantsFreshStart` matched "from scratch" inside "DO NOT rebuild it from scratch".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjectElsewhere, shouldAnswerProjectElsewhere, projectElsewhereSteer, projectElsewhereFallback,
} from '../src/server/AgentV3/projectElsewhere';
import { wantsFreshStart } from '../src/server/AgentV3/IntentClassifier';

const WORKNEX =
  'WORKNEX – ANDROID APK BUILD & SECOND PHONE TESTING\n\n'
  + 'Act as a senior Expo/React Native Android developer, build engineer and QA engineer.\n\n'
  + 'The WORKNEX app is already developed in this Replit project. DO NOT rebuild it from scratch and DO NOT '
  + 'delete or break any existing feature.\n\nGOAL:\nPrepare the existing WORKNEX app, create a real installable '
  + 'Android APK, and make it ready for testing on a second physical Android phone.';

const answer = (prompt: string, userAppExists = false, importing = false) =>
  shouldAnswerProjectElsewhere({ prompt, userAppExists, importing });

describe('the app the user meant is somewhere else', () => {
  it('🔴 the WORKNEX prompt on an empty workspace is ANSWERED, not built', () => {
    expect(answer(WORKNEX)).toBe(true);
    const v = readProjectElsewhere(WORKNEX);
    expect(v.host).toBe('Replit');
    expect(v.forbidsRebuild).toBe(true);
    expect(v.nativeStack).toBe('Expo / React Native');
    expect(v.wantsPhoneBuild).toBe(true);
  });

  it.each([
    'My existing app is on GitHub, please fix the login page',
    'Mera app pehle se bana hua hai Lovable pe, uski APK bana do',
    'The app is already built in Bolt. Do not rebuild it, just add a dark mode',
    'Our existing project was developed in FlutterFlow, make it ready for the Play Store',
    'The site is already developed. Don’t rebuild it — only change the header colour',
  ])('answered: %s', (p) => {
    expect(answer(p)).toBe(true);
  });

  it.each([
    'Build a todo app',
    'Create a complete hospital management system with OPD, IPD and billing',
    'Rebuild my landing page from scratch',
    'I already built the backend in Node, now build the frontend dashboard here',
    'Make an app like WhatsApp',
    'Add a GitHub login button to my notes app',
    'Build a site like my competitor’s, which is on Lovable',
    'Move the cursor to the input when the page opens',
    'Upgrade the app to v0.2 layout',
  ])('NOT answered (an ordinary request): %s', (p) => {
    expect(answer(p)).toBe(false);
  });

  it('🔒 a workspace that holds the user’s app is never intercepted — there IS something to work on', () => {
    expect(answer(WORKNEX, true)).toBe(false);
  });

  it('🔒 an import on this turn is never intercepted — the project is arriving', () => {
    expect(answer(WORKNEX, false, true)).toBe(false);
  });
});

describe('what the reply says', () => {
  const v = readProjectElsewhere(WORKNEX);

  it('names the real import screens, the phone build, and the stack limit', () => {
    const steer = projectElsewhereSteer(v);
    expect(steer).toContain('in Replit');
    expect(steer).toContain('"Import Repo"');
    expect(steer).toContain('"Import project (.zip)"');
    expect(steer).toContain('Download APK');
    expect(steer).toContain('Expo / React Native');
    expect(steer).toMatch(/do NOT invent/i);
  });

  it('without a phone ask or a native stack, the steer stays short', () => {
    const plain = readProjectElsewhere('My existing app is on GitHub, please fix the login page');
    const steer = projectElsewhereSteer(plain);
    expect(steer).not.toContain('Download APK');
    expect(steer).not.toMatch(/cannot package/);
  });

  it('the fallback (engine unreachable) says the same facts in fixed words', () => {
    const text = projectElsewhereFallback(v);
    expect(text).toMatch(/^Your app in Replit is not in this NavBharatAI project yet/);
    expect(text).toContain('Import Repo');
    expect(text).toContain('Download APK');
    expect(text).toMatch(/something new here/);
  });

  it('🔒 White-Label: nothing in either text names an AI vendor or model', () => {
    const all = `${projectElsewhereSteer(v)}\n${projectElsewhereFallback(v)}`;
    expect(all).not.toMatch(/\b(glm|kimi|claude|anthropic|gemini|vertex|grok|openai|gpt|sonnet|opus|haiku|nemotron)\b/i);
  });
});

describe('"DO NOT rebuild it from scratch" is not a request to start fresh', () => {
  it('🔴 the WORKNEX sentence no longer reads as a fresh-start order', () => {
    expect(wantsFreshStart(WORKNEX)).toBe(false);
  });

  it.each([
    'Do not rebuild it from scratch, just add a login',
    'don’t start over, fix the header',
    'Never delete everything, keep my data',
    'scratch se shuru mat karo, bas button theek karo',
  ])('negated: %s', (p) => {
    expect(wantsFreshStart(p)).toBe(false);
  });

  it.each([
    'Start over from scratch',
    'Delete everything and build a new notes app',
    'naya project banao, scratch se shuru karo',
    'Don’t keep this one. Start over.',
  ])('still a fresh start: %s', (p) => {
    expect(wantsFreshStart(p)).toBe(true);
  });
});

describe('REVERSION GUARDS — the route asks, and a failed reply never becomes a build', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('the route sends the turn to the answer lane before any lane is chosen', () => {
    const at = route.indexOf('const answerProjectElsewhere = shouldAnswerProjectElsewhere({');
    const lane = route.indexOf('const isPlainChatTurn = intent === \'chat\'');
    expect(at).toBeGreaterThan(0);
    expect(lane).toBeGreaterThan(at);
    expect(route.slice(at, at + 900)).toContain("intent = 'chat';");
    expect(route.slice(at, at + 900)).toContain('userAppExists');
  });

  it('the steer reaches the reply, and the reply is never cached', () => {
    expect(route).toContain('(answerProjectElsewhere ? projectElsewhereSteer(projectElsewhere) : \'\')');
    expect(route).toMatch(/!clarifyWhatToBuild && !answerProjectElsewhere && chatCacheEnabled\(\)/);
  });

  it('an unreachable engine degrades to the fixed answer, not to the build path', () => {
    expect(route).toContain('if (answerProjectElsewhere) return null;');
    expect(route).toContain('projectElsewhereFallback(projectElsewhere)');
  });
});
