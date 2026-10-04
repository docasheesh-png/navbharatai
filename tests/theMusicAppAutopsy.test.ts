// Autopsy 0473628e ("Music App", Weak, 6.8 min, ₹99.11). Each case uses the report's own text.
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { turnAskedTheUser } from '../src/server/AgentV3/nudgeToBuild';
import { readTurnAnswer, modelsOwnWords } from '../src/server/AgentV3/turnAnswer';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { appSignatureHtml } from '../src/server/AgentV3/appSignature';
import { MIN_TAP_PX } from '../src/server/AgentV3/mobileLayoutCheck';
import { appOwnStylesheet } from '../src/server/AgentV3/kitRestore';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { leanReviewInline, leanReviewAnswersInOneCall } from '../src/server/AgentV3/ReviewerAgent';
import { describeDivergence } from '../src/server/AgentV3/snapshotIdentity';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');

// The second attempt's whole answer, verbatim.
const SECOND_ATTEMPT = 'Hi! A **Music App** it is — I’ll build a clean web music player for you.\n\n'
  + 'Before I start, just 2 quick checks so I make exactly what you need:\n\n'
  + '1. **What should it do?** I’m assuming the basics: browse/search songs, a working audio player with play/pause, next/previous, progress bar, and volume. Do you also want playlists, favourites, or song upload?\n'
  + '2. **Music source:** Should I start with a few built-in sample/demo tracks, or do you want to upload your own songs? (If uploads need to be saved permanently, you’ll need to connect your own storage/database.)\n\n'
  + 'Reply with your must-haves and I’ll get building right away.';
// The first attempt's opening and close (the report truncates its middle).
const FIRST_ATTEMPT = 'Hi! A **Music App** it is.\n\nBefore I start building, here is the core scope I have in mind:\n\n'
  + '1. **Browse & play songs** — a home screen with song cards.\n\nDoes this sound right? And do you want me to add offline upload-your-own songs?';
const NOTHING_BUILT = '\n\n(No files were created, so the build did not run.)';

describe('a question to the user is read from the model\'s words, not ours', () => {
  it('a closing that asks for a reply, after questions, is a question', () => {
    expect(turnAskedTheUser(SECOND_ATTEMPT)).toBe(true);
    expect(turnAskedTheUser('Ready? Let\'s build it.')).toBe(false);
    expect(turnAskedTheUser('I built the player.\n\nReply with feedback any time.')).toBe(false);
  });

  it('the runner\'s own sentence after the answer no longer hides the question', () => {
    // Before: the retry asked the SUMMARY, whose last line is ours.
    expect(readTurnAnswer(FIRST_ATTEMPT + NOTHING_BUILT).asked).toBe(false);
    expect(readTurnAnswer(modelsOwnWords({ summary: FIRST_ATTEMPT + NOTHING_BUILT, modelAnswer: FIRST_ATTEMPT })).asked).toBe(true);
    expect(modelsOwnWords({ summary: 'only the summary' })).toBe('only the summary');
  });

  it('the runner keeps the model\'s words when nothing was built, and both route readers use them', () => {
    expect(runner).toContain('let modelAnswer: string | undefined = builtNothing && !starvedTurn && turn.text.trim() ? turn.text.trim() : undefined;');
    expect(route).toContain('const firstAttempt = readTurnAnswer(modelsOwnWords(result), prompt);');
    expect(route).toContain('const modelAnswer = readTurnAnswer(modelsOwnWords(result), prompt);');
    expect(route).not.toContain('readTurnAnswer(result.summary, prompt)');
  });

  it('READY_BEFORE_END describes the build that shipped (recorded after the retry)', () => {
    expect(route.indexOf("code: 'READY_BEFORE_END'")).toBeGreaterThan(route.indexOf('if (shouldRetryEmptyBuild({'));
  });
});

describe('a confirmed app order is built, not interviewed', () => {
  const prompt = architectSystemPrompt();
  it('the architect is told to build with sensible defaults and ask last', () => {
    expect(prompt).toContain('BUILD, DO NOT INTERVIEW');
    expect(prompt).toContain('never end a turn with a plan and a');
  });
  it('a slider keeps a hit area a finger can grab', () => {
    expect(prompt).toContain('A SLIDER (`<input type="range">`');
  });
});

describe('our own badge passes our own phone check', () => {
  const html = appSignatureHtml();
  it('the link and the × are at least the phone check\'s minimum', () => {
    expect(MIN_TAP_PX).toBe(32);
    expect(html).toContain(`min-height:${MIN_TAP_PX}px`);
    expect(html).toContain(`width:${MIN_TAP_PX}px;height:${MIN_TAP_PX}px`);
  });
});

describe('the lean review is handed the app\'s CSS, not our kit', () => {
  const appRules = '.music-app { display: grid; gap: 16px; }\n.app-player { padding: 24px; }\n';
  const css = `${DESIGN_KIT_CSS}\n${appRules}`;
  it('the kit\'s own blocks are left out and the app\'s rules stay', () => {
    const own = appOwnStylesheet(css)!;
    expect(own).toContain('.music-app');
    expect(own).toContain('.app-player');
    expect(own.length).toBeLessThan(500);
    expect(appOwnStylesheet(appRules)).toBeNull(); // no kit → nothing to strip
  });
  it('a kit stylesheet no longer costs the review its one-call mode', () => {
    const files = new Map([['src/App.tsx', 'export default function App() { return null; }'], ['src/index.css', css]]);
    const raw = leanReviewInline([...files.keys()], (p) => files.get(p));
    expect(raw.omitted).toContain('src/index.css');
    expect(leanReviewAnswersInOneCall(raw)).toBe(true); // since #3470 an omitted stylesheet alone no longer costs one-call mode; the strip below still makes it fit inline
    const stripped = leanReviewInline([...files.keys()], (p) => (p.endsWith('.css') ? (appOwnStylesheet(files.get(p)!) ?? files.get(p)) : files.get(p)));
    expect(leanReviewAnswersInOneCall(stripped)).toBe(true);
    expect(route).toContain("return typeof c === 'string' && /\\.css$/i.test(p) ? (appOwnStylesheet(c) ?? c) : c;");
  });
});

describe('a divergence says how the copies differ', () => {
  it('names sizes and the first differing line', () => {
    const d = describeDivergence('public/icon.svg', '<svg>\n<rect fill="#0f172a"/>\n</svg>\n', '<svg>\n<rect fill="#000"/>\n</svg>\n');
    expect(d).toContain('public/icon.svg');
    expect(d).toContain('first difference at line 2');
    expect(d).toContain('#0f172a');
    expect(route).toContain('describeDivergence(p, sandboxIdentity[p] ?? \'\', savedIdentity[p] ?? \'\')');
  });
});

describe('a short app order the platform started is filed as an app', () => {
  it('"Music App" is app_unsized on a new build, and the routing does not move', () => {
    const asBuild = analyzeRequest({ prompt: 'Music App', buildIntent: 'new_build' });
    const asIs = analyzeRequest({ prompt: 'Music App' });
    expect(asBuild.taskType).toBe('app_unsized');
    expect(asIs.taskType).toBe('chat');
    expect(asBuild.startTier).toBe(asIs.startTier);
    expect(analyzeRequest({ prompt: 'hi', buildIntent: 'new_build' }).taskType).toBe('chat');
  });
});
