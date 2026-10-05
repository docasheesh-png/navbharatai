/**
 * Autopsy 68f0a486 (2026-10-04) — "Gyan Spark Academy", a school app built on the Weak tier, 8.4 min, GREEN.
 * Every fix from that report, each with the report's own input where one exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { isUsableRecipe } from '../src/server/AgentV3/previewRevival';
import { serverLaunchCommand } from '../src/server/AgentV3/devServerLaunchLog';
import { decidePublishConsent } from '../src/server/AgentV3/publishConsent';
import { styleResumeNote } from '../src/server/AgentV3/stylePolishResume';
import { entryLateNote, isUiComponentPath, MIN_SCREENS_BEFORE_NOTE } from '../src/server/AgentV3/earlyPreview';
import { estimateBuildTime, complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import { fleetHistoryFromTelemetry } from '../src/server/AgentV3/etaHistory';
import { asksHowLong, liveUserMessageTurn } from '../src/server/AgentV3/AgentRunner';
import { releaseGate } from '../src/server/AgentV3/releaseGate';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { isLongRunningCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { PRIME_NODE_MODULES, TSC_ENSURE } from '../src/server/AgentV3/tscCommand';
import { writeTypecheckCommand, writeTypecheckWarmupCommand } from '../src/server/AgentV3/writeTimeTypecheck';

const read = (p: string) => readFileSync(p, 'utf8');
const PROMPT = 'app mein video upload karne ke liye ho option Ho PDF upload karne ke liye option Ho usmein student ko manage karne ke liye option Ho फीस मैनेज करने के लिए ऑप्शन हो और ऐसे कई ऑप्शन हो आपके हिसाब से जो अच्छे ऑप्शन लगे उनको ऐड कर दीजिए';
/** The revival recipe the report stored and read back as proven. */
const POISONED_RECIPE = '[ -d /home/user/.warm/vite-react/node_modules ]';

describe('1 · a revival recipe that starts nothing is no recipe', () => {
  it('the recipe the report stored is refused on read, so a wake rediscovers instead of replaying it', () => {
    expect(isUsableRecipe({ devCommand: POISONED_RECIPE, port: 5173, provenAt: 1 } as never)).toBe(false);
    expect(isUsableRecipe({ devCommand: 'npm run dev', port: 5173, provenAt: 1 } as never)).toBe(true);
    expect(isUsableRecipe({ devCommand: 'npm start', port: 3000, provenAt: 1 } as never)).toBe(true);
    expect(isUsableRecipe({ devCommand: 'npm run serve', port: 8080, provenAt: 1 } as never)).toBe(true);
  });

  it('the server segment is found by the launcher\'s classifier — a path naming vite is not the server', () => {
    // The report's shape: our primer in front of the launch. (A hyphenated directory such as `vite-app`
    // is #3515's census, which makes the classifier read whole names.)
    expect(serverLaunchCommand(`${PRIME_NODE_MODULES}npm run dev`)).toBe('npm run dev');
  });

  it('a server writing to its own log keeps both streams there; a pipe into head still loses its 2>&1', () => {
    expect(serverLaunchCommand('npm run server > /tmp/server.log 2>&1')).toBe('npm run server > /tmp/server.log 2>&1');
    expect(serverLaunchCommand('npm run dev 2>&1 | head -40')).toBe('npm run dev');
  });

  it('the commands behind the 30-second typecheck timeouts are not dev-server launches (Q-390, #3506)', () => {
    for (const c of [PRIME_NODE_MODULES, TSC_ENSURE, writeTypecheckCommand(), writeTypecheckWarmupCommand()]) {
      expect(isLongRunningCommand(c), c.slice(0, 60)).toBe(false);
    }
  });
});

describe('2 · a publish word that names a feature of the app is not an ask', () => {
  it('the report\'s own prompt does not switch on the deploy tool', () => {
    expect(decidePublishConsent(PROMPT).consent).toBe('denied');
  });

  it('features stay features, in English, Hinglish and Hindi', () => {
    for (const m of [
      'build a blog where users can publish posts', 'app mein posts publish karne ka option do',
      'live karne ka option ho', 'event host karne ke liye feature chahiye', 'make a deployment tracker',
      'add a button to publish articles', 'students ko assignment upload karne do',
      'लाइव करने के लिए बटन हो', 'वीडियो अपलोड करने का ऑप्शन',
    ]) expect(decidePublishConsent(m).consent, m).toBe('denied');
  });

  it('an order about the app is still an ask', () => {
    for (const m of [
      'publish it', 'deploy this app', 'go live', 'app ko publish karna hai', 'build a todo app and deploy it',
      'isko upload kar do', 'website live kar do', 'build a blog and publish it', 'ऐप पब्लिश करो',
    ]) expect(decidePublishConsent(m).consent, m).toBe('granted');
  });
});

describe('3 · the no-tools review is not told to read files', () => {
  it('the workspace line is given only to an agent that has read_file', () => {
    const sub = read('src/server/AgentV3/SubAgent.ts');
    expect(sub).toMatch(/projectMap && \(deps\.toolsOverride \?\? cfg\.tools\)\.includes\('read_file' as ToolName\)/);
  });
});

describe('4 · the hand-back note counts what it hands back', () => {
  it('an unlabelled field alone is named, not "0 class name(s) … 0 page(s)"', () => {
    const note = styleResumeNote(0, 0, 0, 1);
    expect(note).toContain('1 file(s) had controls a keyboard or screen reader cannot use');
    expect(note).not.toMatch(/^The model ended its turn while 0 class/);
    expect(styleResumeNote(3, 1)).toContain('3 class name(s) had no style rule, 1 page(s) fell short');
  });

  it('both runners pass the accessibility count', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('styleResumeNote(style.missing.length, style.pages.length, style.orphans?.length ?? 0, style.a11y?.length ?? 0)');
    expect(runner).toContain('styleResumeNote(style.missing.length, style.pages.length, 0, style.a11y?.length ?? 0)');
  });
});

describe('5 · screens written while the entry is still the starter are answered at the write', () => {
  it('the report\'s second batch (sidebar, top bar, dashboard) earns the note', () => {
    const note = entryLateNote(['src/types.ts', 'src/lib/store.ts', 'src/components/Sidebar.tsx', 'src/components/Topbar.tsx', 'src/components/Dashboard.tsx']);
    expect(note).toMatch(/still shows the STARTER page/);
    expect(note).toContain('Write src/App.tsx NEXT');
    expect(note).toContain('Sidebar, Topbar, Dashboard');
  });

  it('fewer screens than the threshold, the entry itself, tests and the switch off say nothing', () => {
    expect(entryLateNote(['src/components/Sidebar.tsx'])).toBe('');
    expect(MIN_SCREENS_BEFORE_NOTE).toBe(2);
    expect(isUiComponentPath('src/App.tsx')).toBe(false);
    expect(isUiComponentPath('src/main.tsx')).toBe(false);
    expect(isUiComponentPath('src/components/Fees.test.tsx')).toBe(false);
    expect(isUiComponentPath('src/components/Fees.tsx')).toBe(true);
    expect(entryLateNote(['src/a/A.tsx', 'src/a/B.tsx'], { AGENTV3_EARLY_PREVIEW: 'off' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('every write door asks it, once per agent, never on a module turn that does not own the entry', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('shadow += await this.entryLateNoteFor(paths);');
    // ⚠️ THIS PINNED ITS SIBLINGS' LIST AND BROKE ON A NEW TERM — the third time in this repo
    // (2026-10-05, the browser-only write note). `CLAUDE.md` states the rule it violated: a source
    // guard pins ITS OWN term, never the whole tail. The invariant here is that the entry-late note
    // is carried on `shadow` INSIDE the one guarded sum — which is what is asserted now, and what
    // line 116 and the `_entryLateNoted` guard below already say. A sixth note must not fail this.
    expect(d).toMatch(/return hooks \+ [^;]*\+ shadow \+[^;]*;/);
    expect(d).toMatch(/if \(this\._entryLateNoted \|\| this\._starterExpected \|\| !paths\.some\(isUiComponentPath\)\) return '';/);
  });
});

describe('6 · the ETA band is never narrower than the builds it came from', () => {
  const c = complexityFromPrompt(PROMPT);
  const MIN = 60_000;

  it('days that ranged from 5 to 12 minutes cannot promise ±3% around their average', () => {
    const history = [5, 7, 8, 9, 10, 12].map((m) => ({ complexity: c, durationMs: m * MIN }));
    const est = estimateBuildTime(c, history);
    const sd = Math.sqrt(history.reduce((a, h) => a + (h.durationMs - est.estimateMs) ** 2, 0) / history.length);
    expect(est.highMs - est.estimateMs).toBeGreaterThanOrEqual(Math.round(sd) - 1);
    expect(est.highMs / est.estimateMs).toBeGreaterThan(1.1);
  });

  it('a day\'s own spread (sum of squares) reaches the band through the platform history', () => {
    // Two days, each a mean of 8 min, but one day's builds ranged 4–12 min.
    const sq = (mins: number[]) => mins.reduce((a, m) => a + (m * 60) ** 2, 0);
    const day = (mins: number[]) => ({ byTaskType: { complex_app: { okBuilds: mins.length, okDurationMs: mins.reduce((a, m) => a + m * MIN, 0), okDurationSqSec: sq(mins), builds: mins.length, durationMs: 0 } } });
    const fleet = fleetHistoryFromTelemetry([day([4, 8, 12, 8, 8]), day([8, 8, 8, 8, 8])] as never, 'complex_app', c);
    expect(fleet.history[0].sdMs).toBeGreaterThan(2 * MIN);
    expect(fleet.history[1].sdMs ?? 0).toBe(0);
  });

  it('the telemetry records the sum of squares of successful builds only', () => {
    const tel = read('src/server/AgentV3/AgentV3CostTelemetry.ts');
    expect(tel).toContain('okDurationSqSec: round6((slot.okDurationSqSec ?? 0) + (entry.ok ? (entry.durationMs / 1000) ** 2 : 0)),');
  });
});

describe('7 · a live "how long?" is answered with the ETA the user was shown', () => {
  it('the report\'s own message is a time question; a feature that names time is not', () => {
    expect(asksHowLong('इसको बनने में कितना टाइम लगेगा ऐप को')).toBe(true);
    expect(asksHowLong('how long will it take?')).toBe(true);
    expect(asksHowLong('kitna time lagega')).toBe(true);
    expect(asksHowLong('add a time table screen')).toBe(false);
    expect(asksHowLong('समय सारणी जोड़ो')).toBe(false);
    expect(asksHowLong('इस ऐप में पेरेंट्स के मोबाइल नंबर भी दे दीजिए')).toBe(false);
  });

  it('the turn carries the shown line only when asked', () => {
    const shown = '⏱️ Still building… 4 min in · ~4 min to go';
    expect(liveUserMessageTurn('इसको बनने में कितना टाइम लगेगा ऐप को', shown)).toContain(`"${shown}"`);
    expect(liveUserMessageTurn('add a fees screen', shown)).not.toContain(shown);
    expect(liveUserMessageTurn('kitna time lagega', null)).not.toContain('platform\'s own estimate');
  });

  it('every ETA line goes through the one emitter that remembers it', () => {
    const route = read('src/server/routes/agentv3.ts');
    // One listener, so no ETA emit site can forget to update it.
    expect(route).toMatch(/events\.subscribe\(\(e\) => \{\s*if \(e\.type === 'narration' && \(e as \{ id\?: string \}\)\.id === 'eta-live'/);
    expect(route).toContain('currentEta: () => lastEtaShown');
  });
});

describe('8 · the release gate is honest about what a journey proved', () => {
  const base = { buildOk: true, preview: 'passed', pages: 'not-run', typecheck: 'passed', tests: 'not-run' } as const;

  it('a submit with no reload is not described as "submitted, reloaded"', () => {
    const v = releaseGate({ ...base, journeys: 'passed', journeyReloaded: false } as never, { blockers: 0, highSeverity: 0, warnings: 0 } as never);
    const text = JSON.stringify(v);
    expect(text).toContain('nothing was saved and reloaded');
    expect(text).not.toContain('filled a form, submitted, reloaded');
  });

  it('only the sign-in form answering is the login wall, not a passed journey', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("const appPassed = journeyResults.filter((r) => r.verdict === 'passed' && !journeys.find((j) => j.id === r.id)?.signIn);");
    expect(route).toContain("gateEvidence.journeyUnreachableWhy = 'only the sign-in form was submitted; the screens behind it were not reached';");
  });
});

describe('9 · the kit completes the family its own names invite', () => {
  it('.text-muted, .text-center and .btn-success exist beside .muted, .btn-danger and .badge-success', () => {
    expect(DESIGN_KIT_CSS).toMatch(/small, \.muted, \.text-muted \{/);
    expect(DESIGN_KIT_CSS).toContain('.text-center { text-align: center; }');
    expect(DESIGN_KIT_CSS).toMatch(/\.btn-success \{/);
    expect(DESIGN_KIT_CSS).toContain('.btn-success:disabled');
  });
});
