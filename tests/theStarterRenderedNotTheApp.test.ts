/**
 * AUTOPSY `0d297b25` (2026-09-23) — WORKNEX: a Hello World sold as "built and working".
 *
 * The user asked for an Android APK of an Expo/React Native project that lived on Replit, not here. The
 * workspace held only our seeded starter. The engine wrote one Markdown inspection report, and the
 * readiness gate said the truth — `READINESS_BLOCKER`: "the entry point is still the starter template
 * we seeded — nothing has been built yet" — so the build ended `ok: false`. Then:
 *
 *   - `RENDER_RESCUE` saw the preview render (a Hello World renders perfectly) and flipped it to success;
 *   - `VERDICT_HELD_BY_RUN` held that success against a RED release gate;
 *   - `IN_BUILD_GREEN` told the user "Your app rendered — this working version is now protected";
 *   - the recap said "✅ Here's what I built: … 11 files" (one file was written: the report);
 *   - and ₹47.36 of the welcome balance was charged, with the full markup.
 *
 * Plus two classifier misreads in the same build: "send the APK using WhatsApp" → "clone of WhatsApp",
 * and "Expo/React Native" → an EVENTS app (Expo read as an exhibition). And two report lines that said
 * false things about a planner call our own 90 s cap had stopped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STARTER_ENTRY_CONTENT, entryIsStillTheStarter, isStarterBlocker, starterAppBlocker, starterSummary,
  starterRenderNote, STARTER_RENDER_CODE,
} from '../src/server/AgentV3/stillTheStarterApp';
import { renderRescueConfirmsSuccess } from '../src/server/AgentV3/renderRescue';
import { summarizeProject, isProjectSummaryNarration } from '../src/server/AgentV3/ProjectSummary';
import { analyzeAppScope, namesAsProduct } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { emptyWasteLedger, wasteSummary } from '../src/server/AgentV3/providerWaste';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const readerOf = (files: Record<string, string>) => async (p: string) => {
  if (!(p in files)) throw new Error('ENOENT');
  return files[p];
};

describe('a browser that rendered the starter did not render the app', () => {
  it('the untouched starter entry is recognised — the WORKNEX workspace exactly', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.tsx': STARTER_ENTRY_CONTENT }))).toBe(true);
  });

  it('a whitespace-only difference is still the starter; any real edit is not', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.tsx': `\n\n${STARTER_ENTRY_CONTENT.replace(/\n/g, '\n  ')}  ` }))).toBe(true);
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.tsx': STARTER_ENTRY_CONTENT.replace('Hello World', 'WORKNEX') }))).toBe(false);
  });

  it('🔒 an unreadable entry never vetoes a real app’s proof', async () => {
    expect(await entryIsStillTheStarter(readerOf({}))).toBe(false);
    expect(await entryIsStillTheStarter(async () => { throw new Error('sandbox gone'); })).toBe(false);
  });

  it('the first READABLE entry decides, in the same order the readiness gate walks', async () => {
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.jsx': STARTER_ENTRY_CONTENT }))).toBe(true);
    expect(await entryIsStillTheStarter(readerOf({ 'src/App.tsx': 'export default () => <main>Real app</main>;', 'src/App.jsx': STARTER_ENTRY_CONTENT }))).toBe(false);
  });

  it('🔴 the render rescue refuses a starter render — the exact 0d297b25 upgrade', () => {
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0, stillTheStarter: true })).toBe(false);
    // Unchanged for a real app.
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0, stillTheStarter: false })).toBe(true);
    expect(renderRescueConfirmsSuccess({ rendered: true, consoleErrorCount: 0 })).toBe(true);
  });

  it('the admin line names the starter and says what it did NOT earn', () => {
    const n = starterRenderNote('render rescue');
    expect(n.code).toBe(STARTER_RENDER_CODE);
    expect(n.severity).toBe('info');
    expect(n.autoResolved).toBe(false);
    expect(n.message).toMatch(/starter page/);
    expect(n.message).toMatch(/markup/);
  });
});

describe('the user is told nothing was built — and keeps the model’s own finding', () => {
  it('the starter blocker is recognised by the ONE producer’s text', () => {
    expect(isStarterBlocker(starterAppBlocker(STARTER_ENTRY_CONTENT)!)).toBe(true);
    expect(isStarterBlocker('Unresolved import ./Foo in src/App.tsx')).toBe(false);
  });

  it('says there is no app, instead of "a couple of things still need fixing"', () => {
    const s = starterSummary('The workspace does not contain the WORKNEX app — it is a blank Vite scaffold.');
    expect(s).toMatch(/^⚠️ Nothing has been built yet/);
    expect(s).toContain('does not contain the WORKNEX app');
    expect(s).not.toMatch(/a couple of things/);
  });

  it('a very long model reply is capped, with an ellipsis, never cut silently', () => {
    const s = starterSummary('word '.repeat(2_000));
    expect(s.length).toBeLessThan(1_800);
    expect(s.endsWith('…')).toBe(true);
    expect(starterSummary('')).toMatch(/^⚠️ Nothing has been built yet[^\n]*$/);
  });
});

describe('the recap counts what THIS run wrote', () => {
  const graph = {
    files: Array.from({ length: 11 }, (_, i) => `f${i}.ts`),
    components: [], routes: [], symbols: [], edges: [],
  } as unknown as Parameters<typeof summarizeProject>[0];

  it('🔴 one report written into an 11-file scaffold is not "Here\'s what I built: 11 files"', () => {
    const s = summarizeProject(graph, 'x', { changedFiles: 1, editMode: false, changedPaths: ['INSPECTION_REPORT.md'] });
    expect(s).not.toContain("Here's what I built");
    expect(s).toMatch(/^📝 No app code was written this time — I only wrote a note \(INSPECTION_REPORT\.md\)/);
    expect(s).toContain('Project: 11 files');
    expect(isProjectSummaryNarration(s)).toBe(true);
  });

  it('unchanged: engine-only setup files on an edit still read as setup, not as notes', () => {
    const s = summarizeProject(graph, 'x', { changedFiles: 1, editMode: true, changedPaths: ['.env'] });
    expect(s).toMatch(/^🔍 I analyzed your project\. Your source files are untouched/);
  });

  it('unchanged: a real build that also wrote a README still says it built', () => {
    const s = summarizeProject(graph, 'x', { changedFiles: 2, editMode: false, changedPaths: ['src/App.tsx', 'README.md'] });
    expect(s).toMatch(/^✅ Here's what I built:/);
  });
});

describe('a product named as a TOOL is not a clone request', () => {
  const worknex = () => {
    const report = 'Act as a senior Expo/React Native Android developer. Build an APK.\n'
      + 'Phone 1: Download APK → Send APK to Phone 2 using WhatsApp/Drive/USB/etc.\n'
      + 'If the project uses Expo, configure EAS correctly.';
    return report;
  };

  it('🔴 "send the APK using WhatsApp/Drive/USB" is not a WhatsApp clone', () => {
    expect(analyzeAppScope(worknex()).famousApp).toBeNull();
  });

  it.each([
    'send the invoice via WhatsApp',
    'add a share on WhatsApp button to my recipe app',
    'login with Facebook for my todo app',
    'upload the video to YouTube from the app',
    'use the Spotify API to show my playlists',
  ])('tool mention: %s', (p) => {
    expect(analyzeAppScope(p).famousApp).toBeNull();
  });

  it.each([
    ['build a whatsapp clone', 'WhatsApp'],
    ['WhatsApp jaisa chat app banao', 'WhatsApp'],
    ['instagram clone with instagram login', 'Instagram'],
    ['an app like Uber', 'Uber / Ola'],
  ])('still a clone: %s', (p, name) => {
    expect(analyzeAppScope(p).famousApp).toBe(name);
  });

  it('one product mention among tool mentions still counts', () => {
    expect(namesAsProduct('make me a whatsapp, and share invites via whatsapp', /\bwhatsapp\b/i)).toBe(true);
  });
});

describe('Expo is a React Native toolchain, not an exhibition', () => {
  it('🔴 the WORKNEX prompt is not an events app', () => {
    const p = 'Act as a senior Expo/React Native Android developer. Framework and Expo/React Native version. '
      + 'If the project uses Expo, configure EAS correctly. Booking, payments, admin panel, notifications.';
    expect(analyzeRequirementGaps(p).domain).not.toBe('events');
  });

  it('an expo that IS an event keeps its domain', () => {
    expect(analyzeRequirementGaps('an app for our handicrafts expo with ticket booking, schedule and QR entry').domain).toBe('events');
  });
});

describe('the report stops saying false things about a call our own clock stopped', () => {
  it('the waste line no longer claims every call returned something', () => {
    const line = wasteSummary(emptyWasteLedger(), 240_000);
    expect(line).not.toMatch(/every model call this build returned something/);
    expect(line).toContain('stopped by our own clock is not counted');
  });

  it('the step deadline is not called the BUILD\'s budget', () => {
    const runner = src('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');
    expect(runner).not.toContain("This build's time budget ended");
    expect(runner).toContain('The time allowed for this step ran out');
  });

  it('a failed plan call still records its minutes as PLAN', () => {
    const sb = src('src/server/AgentV3/SimpleBuilder.ts');
    const tryAt = sb.indexOf("planCap, 'simple-plan');");
    const finallyAt = sb.indexOf('clock.planMs = Date.now() - laneStartedAt;', tryAt);
    expect(tryAt).toBeGreaterThan(0);
    expect(finallyAt).toBeGreaterThan(tryAt);
    expect(sb.slice(tryAt, finallyAt)).toContain('} finally {');
  });
});

describe('REVERSION GUARDS — every producer of the render proof asks the one question', () => {
  const route = src('src/server/routes/agentv3.ts');

  it('the helper exists once and reads through the shared module', () => {
    expect(route).toContain('const renderIsOnlyTheStarter = (): Promise<boolean> => entryIsStillTheStarter(');
  });

  it.each(['in-build green', 'render rescue', 'preview verify loop', 'last-chance proof'])('%s records the veto', (where) => {
    expect(route).toContain(`starterRenderNote('${where}')`);
  });

  it('the rescue passes the fact to the predicate', () => {
    expect(route).toContain('renderRescueConfirmsSuccess({ rendered: verdict.rendered, consoleErrorCount: consoleErrs.length, runtimeCrashBlocker, stillTheStarter })');
  });

  it('the in-build green checks BEFORE opening a browser', () => {
    const at = route.indexOf("starterRenderNote('in-build green')");
    const browse = route.indexOf("'in-build-green');", at - 2_000);
    expect(at).toBeGreaterThan(0);
    expect(browse).toBeGreaterThan(at);
  });

  it('the readiness gate and the proofs share ONE implementation', () => {
    const d = src('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('entryIsStillTheStarter(');
    const a = src('src/server/AgentV3/AgentRunner.ts');
    expect(a).toContain('readiness.blockers.some(isStarterBlocker)');
  });
});
