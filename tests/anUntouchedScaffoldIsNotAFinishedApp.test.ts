import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STARTER_ENTRY_CONTENT, STARTER_ENTRY_PATHS, isUntouchedStarterEntry, starterAppBlocker,
} from '../src/server/AgentV3/stillTheStarterApp';
import { appIsDone, doneSteer } from '../src/server/AgentV3/doneSignal';
import { appTsx } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

/**
 * An untouched scaffold is not a finished app.
 *
 * 🔴 Autopsy 31dc61fd. Five minutes into a UPSC-app build the platform told the model the app was
 * "complete and healthy — 100/100, no blockers" and narrated "✅ The app looks complete — wrapping
 * up." The workspace at that moment, from the build's own `cat src/App.tsx`:
 *
 *     function App() { return (<div><h1>Hello World</h1></div>); }
 *
 * The model DISBELIEVED us and kept building. A model rescuing a platform signal is a red flag, not a
 * self-heal — the next model may simply obey and hand over a Hello World.
 *
 * The score was 100 because readiness measures CODE HEALTH and a pristine scaffold has no defects.
 * That is the same class BuildJudge.ts fixed for the JUDGE on 2026-08-06 ("the emptier the app, the
 * better it scored") — and the readiness gate was never hunted.
 */

const ready = (over: Partial<{ score: number; ready: boolean; blockers: string[] }> = {}) => ({
  score: 100, ready: true, blockers: [] as string[], warnings: [], tier: 'enterprise' as const, ...over,
});

describe('the rule itself', () => {
  it('🔴 the exact seeded template is recognised as untouched', () => {
    expect(isUntouchedStarterEntry(STARTER_ENTRY_CONTENT)).toBe(true);
  });

  it('the template it compares against IS the one the scaffold seeds — not a copy that can drift', () => {
    expect(STARTER_ENTRY_CONTENT).toBe(appTsx);
  });

  it('reformatting alone is still untouched — only a formatter could have done that', () => {
    expect(isUntouchedStarterEntry(STARTER_ENTRY_CONTENT.replace(/\n\s*/g, '\n      '))).toBe(true);
    expect(isUntouchedStarterEntry(`   ${STARTER_ENTRY_CONTENT}   `)).toBe(true);
  });

  /**
   * ⚠️ THE PRECISION LOCK. A false YES would block a finished app from ever being called done, so the
   * match is EXACT — never a heuristic like "contains Hello World", which a real app may legitimately.
   */
  it.each([
    ['a real app', 'import Dashboard from "./Dashboard";\nexport default function App(){return <Dashboard/>;}'],
    ['an app that greets the world', 'export default function App(){return <h1>Hello World, from Asheesh</h1>;}'],
    ['the template plus one import', `import "./x";\n${STARTER_ENTRY_CONTENT}`],
    ['the template with the heading changed', STARTER_ENTRY_CONTENT.replace('Hello World', 'IAS Prep Hub')],
    ['an empty file', ''],
  ])('%s is NOT the untouched template', (_label, content) => {
    expect(isUntouchedStarterEntry(content)).toBe(false);
  });

  it('a file we could not read is not a verdict — "could not look" is never "it is a scaffold"', () => {
    expect(isUntouchedStarterEntry(null)).toBe(false);
    expect(isUntouchedStarterEntry(undefined)).toBe(false);
    expect(starterAppBlocker(null)).toBeNull();
  });

  it('the blocker says WHY the score was high, because that is the confusing part', () => {
    const b = starterAppBlocker(STARTER_ENTRY_CONTENT)!;
    expect(b).toMatch(/starter template/i);
    expect(b).toMatch(/no defects|nothing has been built/i);
  });
});

describe('…and it reaches the done signal through the mechanism that already exists', () => {
  it('🔴 a 100/100 report carrying this blocker is NOT done', () => {
    const blocked = ready({ ready: false, blockers: [starterAppBlocker(STARTER_ENTRY_CONTENT)!] });
    expect(appIsDone(blocked)).toBe(false);
    expect(doneSteer(blocked)).toBeNull();
  });

  it('a genuinely finished app is still done — this must not stop real builds finishing', () => {
    expect(appIsDone(ready())).toBe(true);
    expect(doneSteer(ready())).toContain('BUILD CHECKPOINT');
  });
});

describe('the wiring — asserted from source, comments stripped', () => {
  const dispatcher = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('assessBuildReadiness runs the check before returning', () => {
    expect(dispatcher).toContain('_blockIfStillTheStarterApp(report)');
  });

  it('it adds a BLOCKER and clears `ready` — not a warning nobody acts on', () => {
    const at = dispatcher.indexOf('_blockIfStillTheStarterApp(report: ReadinessReport)');
    expect(at).toBeGreaterThan(-1);
    const body = dispatcher.slice(at, at + 900);
    expect(body).toContain('ready: false');
    expect(body).toContain('blockers: [...report.blockers');
  });

  it('it fails OPEN — an unreadable entry leaves the report untouched', () => {
    const at = dispatcher.indexOf('_blockIfStillTheStarterApp(report: ReadinessReport)');
    const body = dispatcher.slice(at, at + 900);
    // Re-aimed (autopsy 0d297b25): the per-entry walk moved into the SHARED `entryIsStillTheStarter`,
    // which every render proof now asks too — so "unreadable ⇒ skip" is asserted where it now lives,
    // and the dispatcher must still return the report untouched when the answer is not "starter".
    const shared = readFileSync(join(process.cwd(), 'src/server/AgentV3/stillTheStarterApp.ts'), 'utf8');
    const walk = shared.slice(shared.indexOf('export async function entryIsStillTheStarter'));
    expect(walk).toContain('catch { continue; }');
    expect(walk).toContain('return false;');
    expect(body).toContain('if (!starter) return report;');
    expect(body.includes('return report;')).toBe(true);
  });

  it('every candidate entry path is a real scaffold entry name', () => {
    expect(STARTER_ENTRY_PATHS.length).toBeGreaterThan(0);
    for (const p of STARTER_ENTRY_PATHS) expect(p).toMatch(/App\.(tsx|jsx)$/);
  });
});
