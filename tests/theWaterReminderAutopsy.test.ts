/**
 * Autopsy d829b523 (2026-09-26, report read 2026-09-27) — "Build a water drinking reminder app…",
 * Weak tier, ok in 341 s, release gate YELLOW.
 *
 * Three defects that were still live on `main` when the report was read (the rest of the report —
 * the "Auto-fixed" lines about refused heals, HEAL_NOT_DURABLE, the stale snapshot, the starter test
 * with a wrong import, the E2E net's dependency — had already been fixed the same afternoon by
 * e22028a2, 3d04a737 and 6c1f04dd):
 *
 *   1. The app was NAMED AFTER THE ORDER. Manifest short_name "Build a wate", meta description and
 *      og tags the prompt word for word, an icon monogram of "B" — in the published app, while the
 *      model had called it HydroTrack in its own <title>.
 *   2. A REMINDER APP WAS SIZED AS A HOSPITAL ERP. `productivity` is the todo family, and
 *      `namesBusinessDomain` promoted it to complex_app (58): the build opened on the always-reasoning
 *      rung, the fast lane was skipped, first render at 237 s for a one-screen localStorage app.
 *   3. THE JOURNEY CHECK TYPED INTO A DROPDOWN. `fill()` on the onboarding form's <select> threw
 *      "Element is not an <input>, <textarea> or [contenteditable] element"; the journey was recorded
 *      unreachable and the release gate said no journey was proven. Its `type="time"` fields would
 *      have been refused next: they were being filled with the marker string.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAppDisplayName,
  titleFromIndexHtml,
  nameFromPrompt,
  shortNameFor,
} from '../src/server/AgentV3/appDisplayName';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { namesBusinessDomain, namesPersonalTool } from '../src/server/lib/appComplexitySignals';
import { deriveJourneys, journeyScript, valueForInput } from '../src/server/AgentV3/journeyDerivation';

const THE_PROMPT =
  'Build a water drinking reminder app which reminds me to drink water in regular duration according the weight and height ratio. Take input of height weight and age and suggest necessary amount of water needed';

const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('1 · the app is named, not ordered', () => {
  const html = '<!doctype html><html><head><title>HydroTrack</title></head><body><div id="root"></div></body></html>';

  it('the model\'s own <title> is the name — the real report\'s case', () => {
    const d = resolveAppDisplayName({ indexHtml: html, prompt: THE_PROMPT });
    expect(d.name).toBe('HydroTrack');
    expect(d.shortName).toBe('HydroTrack');
    expect(d.source).toBe('index-title');
  });

  it('🔒 nothing the defaults pass writes carries the order', () => {
    const d = resolveAppDisplayName({ indexHtml: html, prompt: THE_PROMPT });
    const out = planAppDefaults(html, d.name, { description: d.description, shortName: d.shortName });
    const manifest = JSON.parse(out.files['manifest.webmanifest']);
    expect(manifest.name).toBe('HydroTrack');
    expect(manifest.short_name).toBe('HydroTrack');
    const everything = `${out.indexHtml}\n${Object.values(out.files).join('\n')}`;
    expect(everything).not.toMatch(/Build a water/);
    expect(everything).not.toMatch(/Build a wate\b/);
    // The description tells a visitor what the app does, in their person, not ours.
    expect(out.indexHtml).toMatch(/<meta name="description" content="A water drinking reminder app which reminds you to drink water/);
    expect(out.files['icon.svg']).toMatch(/>H<\/text>/);
  });

  it('a template placeholder title is not a name — the order, stripped of its verb, is', () => {
    for (const t of ['App', 'Vite + React + TS', 'React App', 'My App', 'NavBharatAI Preview', 'Document']) {
      expect(titleFromIndexHtml(`<title>${t}</title>`), t).toBeNull();
    }
    const d = resolveAppDisplayName({ indexHtml: '<title>Vite + React + TS</title>', prompt: THE_PROMPT });
    expect(d.name).toBe('Water Drinking Reminder');
    expect(d.source).toBe('prompt');
  });

  it('the user\'s chosen name beats both', () => {
    const d = resolveAppDisplayName({ chosenName: '  Paani   Pio ', indexHtml: html, prompt: THE_PROMPT });
    expect(d.name).toBe('Paani Pio');
    expect(d.source).toBe('user-chosen');
  });

  it('a <title> that is itself the order is refused', () => {
    expect(titleFromIndexHtml('<title>Build a water drinking reminder app which reminds me</title>')).toBeNull();
  });

  it('English and Hinglish orders both reduce to the thing asked for', () => {
    expect(nameFromPrompt('Make me an expense tracker with charts')).toBe('Expense Tracker');
    expect(nameFromPrompt('ek billing app banao')).toBe('Billing');
    expect(nameFromPrompt('mujhe ek notes app chahiye')).toBe('Notes');
    expect(nameFromPrompt('banana shop ka app banao')).toBe('Banana Shop');
    expect(nameFromPrompt('Can you build a tic-tac-toe game?')).toBe('Tic-Tac-Toe Game');
    expect(nameFromPrompt('')).toBeNull();
    expect(nameFromPrompt('!!!')).toBeNull();
  });

  it('the home-screen label keeps whole words and never exceeds 12 characters', () => {
    expect(shortNameFor('Water Drinking Reminder')).toBe('Water');
    expect(shortNameFor('HydroTrack')).toBe('HydroTrack');
    expect(shortNameFor('Supercalifragilistic')).toBe('Supercalifra');
    for (const n of ['A', 'Hospital Management', 'Tic-Tac-Toe Game']) expect(shortNameFor(n).length).toBeLessThanOrEqual(12);
  });

  it('nothing to go on ⇒ the old placeholder, never an empty name', () => {
    const d = resolveAppDisplayName({ indexHtml: null, prompt: '' });
    expect(d.name).toBe('App');
    expect(d.description).toBe('App');
  });

  it('a quote in the derived name cannot break the document', () => {
    const d = resolveAppDisplayName({ indexHtml: '<title>Tom &amp; "Jerry"</title>', prompt: 'build a game' });
    expect(d.name).toBe('Tom & "Jerry"');
    const out = planAppDefaults('<html><head></head><body></body></html>', d.name, { description: d.description });
    expect(out.indexHtml).toContain('content="Tom &amp; &quot;Jerry&quot;"');
  });

  it('⚠️ REVERSION GUARD — both callers resolve the name; the route no longer hands over the prompt', () => {
    const route = codeOnly(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
    const tool = codeOnly(readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8'));
    expect(route).not.toMatch(/const appName = deriveTitle\(prompt\)/);
    expect(route).toMatch(/resolveAppDisplayName\(\{ chosenName: chosenAppName, indexHtml, prompt \}\)/);
    expect(tool).toMatch(/resolveAppDisplayName\(\{ chosenName: optStr\(input, 'app_name'\), indexHtml \}\)/);
  });
});

describe('2 · a reminder app is the todo family, not a business domain', () => {
  it('the real prompt is a simple app — it opens on the cheap rung and keeps the fast lane', () => {
    const r = analyzeRequest({ prompt: THE_PROMPT, buildIntent: 'new_build' } as never);
    expect(r.taskType).toBe('simple_app');
    expect(r.complexityScore).toBeLessThan(40);
  });

  it('the rest of the family agrees with "a todo app"', () => {
    for (const p of ['build a reminder app', 'build a habit tracker', 'build a daily planner app', 'build a kanban board', 'a todo app']) {
      expect(namesBusinessDomain(p), p).toBe(false);
      expect(analyzeRequest({ prompt: p }).taskType, p).toBe('simple_app');
    }
    expect(namesPersonalTool('build a reminder app')).toBe(true);
  });

  it('🔒 scope still wins — a task manager with accounts and a database stays complex', () => {
    expect(analyzeRequest({ prompt: 'a team task manager with login and a database' }).taskType).toBe('complex_app');
  });

  it('🔒 the business domains are untouched', () => {
    for (const p of ['hospital management system', 'restaurant billing app', 'a gym membership app', 'E commerce website']) {
      expect(namesBusinessDomain(p), p).toBe(true);
      expect(analyzeRequest({ prompt: p }).taskType, p).toBe('complex_app');
    }
    expect(namesPersonalTool('hospital management system')).toBe(false);
  });

  it('a landing page for a planner is still a page, not a tool', () => {
    expect(namesPersonalTool('a landing page for my planner app')).toBe(false);
  });
});

describe('3 · the journey chooses from a dropdown and gives a time a time', () => {
  it('each strict input type gets a value the browser accepts', () => {
    expect(valueForInput('<input type="time" name="wake" />', 'm')).toBe('08:00');
    expect(valueForInput('<input type="datetime-local" name="at" />', 'm')).toBe('2030-01-01T08:00');
    expect(valueForInput('<input type="month" name="m" />', 'm')).toBe('2030-01');
    expect(valueForInput('<input type="week" name="w" />', 'm')).toBe('2030-W01');
    expect(valueForInput('<input type="color" name="c" />', 'm')).toBe('#336699');
    expect(valueForInput('<input type="date" name="d" />', 'm')).toBe('2030-01-01');
  });

  it('a number respects its own literal bounds — the report\'s weight field', () => {
    expect(valueForInput('<input type="number" name="weight" min="30" max="300" />', 'm')).toBe('30');
    expect(valueForInput('<input type="number" name="age" max="5" />', 'm')).toBe('5');
    expect(valueForInput('<input type="number" name="qty" />', 'm')).toBe('7');
    // A bound written as an expression cannot be read here; it is left to the browser, as before.
    expect(valueForInput('<input type="number" name="age" min={MIN_AGE} />', 'm')).toBe('7');
  });

  it('a range is not typed into — it always holds a value already', () => {
    const form = `export default function F() {
  const [items, setItems] = useState([]);
  return (<form onSubmit={(e) => { e.preventDefault(); setItems([...items, 1]); }}>
    <input name="title" />
    <input type="range" name="glasses" min="1" max="20" />
    <button type="submit">Add</button>
    <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
  </form>);
}`;
    const js = deriveJourneys({ files: { 'src/App.tsx': form }, routes: ['/'], marker: 'nbai-x' });
    expect(js.length).toBe(1);
    expect(js[0].fields.map((f) => JSON.stringify(f.target))).not.toContain(JSON.stringify({ kind: 'name', value: 'glasses' }));
  });

  it('🔒 the runner chooses a <select> option instead of typing into it', () => {
    const script = journeyScript('https://5173-x.e2b.app', [
      { id: 'form-submit:/', kind: 'form-submit', route: '/', fields: [{ target: { kind: 'name', value: 'gender' }, value: 'x' }], submit: null },
    ] as never, 'nbai-x');
    const body = codeOnly(script);
    expect(body).toMatch(/tagName\.toLowerCase\(\)/);
    expect(body).toMatch(/if \(tag === 'select'\)/);
    expect(body).toMatch(/selectOption\(options\[0\]/);
    // …and the select branch is BEFORE the fill, or a dropdown still reaches fill().
    expect(body.indexOf("tag === 'select'")).toBeLessThan(body.indexOf('await el.fill('));
  });

  it('the generated journey script is still real JavaScript', () => {
    const script = journeyScript('https://5173-x.e2b.app', [
      { id: 'create-persists:/', kind: 'create-persists', route: '/', fields: [{ target: { kind: 'name', value: 'wake' }, value: '08:00' }], submit: null },
    ] as never, 'nbai-x');
    const start = script.indexOf('\n', script.indexOf("<<'NBAI_EOF'")) + 1;
    const end = script.indexOf('\nNBAI_EOF', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const dir = mkdtempSync(join(tmpdir(), 'nbai-journey-'));
    const file = join(dir, 'journey.mjs');
    writeFileSync(file, script.slice(start, end));
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
  });
});
