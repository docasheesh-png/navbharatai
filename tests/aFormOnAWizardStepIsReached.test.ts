/**
 * Q-016, from autopsy 2b1f845e (2026-10-01): a five-step studio kept its forms in `src/steps/*.tsx`, shown
 * by pressing "2 Design", "3 Review"… on `/`. No page reaches them by URL, so no save journey was derived,
 * and the release gate stayed YELLOW with "no user journey could be derived" — while the click explorer
 * had pressed those very steps. Such a form now gets a journey that presses the one control named after
 * its screen, and presses it again after the reload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  deriveJourneys, reachWordFor, journeyScript, parseJourneyResults, TOOLS_DIR, type Journey,
} from '../src/server/AgentV3/journeyDerivation';
import { playwrightImport } from '../src/server/AgentV3/sandboxBrowserScript';
import { makeTempDir } from './helpers/tempDir';

const MARKER = 'nbai-check-7';

const APP = `import { StudioShell } from './components/StudioShell';
export default function App() { return <StudioShell />; }`;
const SHELL = `import { DesignStep } from '../steps/DesignStep';
export function StudioShell() {
  const [step, setStep] = useState(1);
  return <main><nav><button onClick={() => setStep(1)}>1 Plan</button><button onClick={() => setStep(2)}>2 Design</button></nav>{step === 2 && <DesignStep />}</main>;
}`;
const DESIGN = `export function DesignStep() {
  const [ideas, setIdeas] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); setIdeas([...ideas, title]); }}>
      <label htmlFor="title">Idea</label>
      <input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add idea</button>
      <ul>{ideas.map((i) => <li key={i}>{i}</li>)}</ul>
    </form>
  );
}`;
const FILES = { 'src/App.tsx': APP, 'src/components/StudioShell.tsx': SHELL, 'src/steps/DesignStep.tsx': DESIGN };

describe('the word that opens a screen comes from its file name, and is never an action', () => {
  it('steps, tabs and panels', () => {
    expect(reachWordFor('src/steps/DesignStep.tsx')).toBe('design');
    expect(reachWordFor('src/tabs/RevenueTab.tsx')).toBe('revenue');
    expect(reachWordFor('src/screens/InventoryScreen.jsx')).toBe('inventory');
  });
  it('an action word is refused — pressing "Post" or "Pay" could publish or charge', () => {
    for (const p of ['src/steps/PostStep.tsx', 'src/steps/PayStep.tsx', 'src/steps/SendScreen.tsx', 'src/steps/DeleteTab.tsx', 'src/steps/AddPanel.tsx']) {
      expect(reachWordFor(p)).toBeNull();
    }
  });
  it('a generic name says nothing', () => {
    for (const p of ['src/components/Form.tsx', 'src/components/Modal.tsx', 'src/App.tsx', 'src/Ui.tsx']) expect(reachWordFor(p)).toBeNull();
  });
});

describe('a form no page reaches gets a journey that opens its screen first', () => {
  it('the report\'s shape: App → StudioShell → steps/DesignStep', () => {
    const js = deriveJourneys({ files: FILES, routes: [], marker: MARKER });
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ kind: 'create-persists', route: '/', reach: 'design' });
    expect(js[0].id).toBe('create-persists:src/steps/DesignStep.tsx');
  });

  it('a form whose submit is an outward action gets no journey', () => {
    const send = DESIGN.replace('<button type="submit">Add idea</button>', '<button type="submit">Send campaign</button>');
    expect(deriveJourneys({ files: { ...FILES, 'src/steps/DesignStep.tsx': send }, routes: [], marker: MARKER })).toEqual([]);
  });

  it('a form a page already reaches is not derived twice', () => {
    const page = { 'src/App.tsx': `import { DesignStep } from './steps/DesignStep';\nexport default function App(){ return <DesignStep/>; }`, 'src/steps/DesignStep.tsx': DESIGN };
    const js = deriveJourneys({ files: page, routes: [], marker: MARKER });
    expect(js).toHaveLength(1);
    expect(js[0].reach).toBeUndefined();
  });

  it('the runner carries the reach word, and is valid JavaScript', () => {
    const js = deriveJourneys({ files: FILES, routes: [], marker: MARKER });
    const script = journeyScript('http://x/', js, MARKER);
    expect(script).toContain('reach: "design"');
    const body = script.slice(script.indexOf("<<'NBAI_EOF'\n") + 13, script.lastIndexOf('\nNBAI_EOF'));
    const dir = makeTempDir('nbai-reach-');
    writeFileSync(join(dir, 'run.mjs'), body);
    execFileSync(process.execPath, ['--check', join(dir, 'run.mjs')]);
    // A single backslash inside the TS template would reach the page as a different character.
    expect(body).toContain('.replace(/\\s+/g');
  });
});

// A REAL BROWSER, where one exists (see theAppIsPressedNotOnlyPainted.test.ts). CI has none.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

/** The wizard, as plain HTML. `keep` saves the ideas in localStorage; a reload always lands on step 1. */
const wizard = (opts: { keep: boolean; designLabel?: string }) => `<!doctype html><html><body><div id="root">
<nav><button id="s1">1 Plan</button><button id="s2">${opts.designLabel ?? '2 Design'}</button><button id="p">Post now</button></nav>
<section id="plan"><h1>Plan</h1></section>
<section id="design" hidden><form id="f"><label for="title">Idea</label><input id="title" name="title"><button type="submit">Add idea</button></form><ul id="list"></ul></section>
</div><script>
const keep = ${opts.keep};
let ideas = keep ? JSON.parse(localStorage.getItem('ideas') || '[]') : [];
const draw = () => { document.getElementById('list').innerHTML = ideas.map((i) => '<li>' + i + '</li>').join(''); };
document.getElementById('s1').onclick = () => { plan.hidden = false; design.hidden = true; };
document.getElementById('s2').onclick = () => { plan.hidden = true; design.hidden = false; draw(); };
document.getElementById('p').onclick = () => { document.body.dataset.posted = 'yes'; };
document.getElementById('f').onsubmit = (e) => { e.preventDefault(); ideas.push(title.value); if (keep) localStorage.setItem('ideas', JSON.stringify(ideas)); draw(); };
</script></body></html>`;

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const pages: Record<string, string> = {
    '/keeps': wizard({ keep: true }),
    '/loses': wizard({ keep: false }),
    '/no-control': wizard({ keep: true, designLabel: '2 Look' }),
    '/trap': wizard({ keep: true, designLabel: 'Delete design' }),
  };
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const body = pages[(q.url ?? '/').split('?')[0].replace(/\/+$/, '')] ?? pages[(q.url ?? '/').split('?')[0]];
      r.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      r.end(body ?? `Cannot GET ${q.url}`);
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function run(path: string): Promise<{ verdict: string; note: string; via?: string }> {
    const js: Journey[] = deriveJourneys({ files: FILES, routes: [], marker: MARKER }).map((j) => ({ ...j, route: path }));
    const script = journeyScript(base, js, MARKER);
    const body = script.slice(script.indexOf("<<'NBAI_EOF'\n") + 13, script.lastIndexOf('\nNBAI_EOF'))
      .replace(playwrightImport(TOOLS_DIR), `import playwright from '${PW}';\nconst { chromium } = playwright;`);
    const dir = makeTempDir('nbai-reach-real-');
    writeFileSync(join(dir, 'run.mjs'), body);
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [join(dir, 'run.mjs')], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const r = parseJourneyResults(stdout)[0] as unknown as { verdict: string; note: string; via?: string };
    const raw = stdout.split('\n').find((l) => l.includes('"via"'));
    return { ...r, via: raw ? JSON.parse(raw.slice(raw.indexOf('{'))).via : undefined };
  }

  it('presses "2 Design", saves an idea, reloads, presses it again, and finds the idea', async () => {
    const r = await run('/keeps');
    expect(r.verdict).toBe('passed');
    expect(r.via).toBe('2 Design');
  }, 120_000);

  it('an idea that is shown but never saved is caught', async () => {
    const r = await run('/loses');
    expect(r.verdict).toBe('failed');
    expect(r.note).toMatch(/vanished on reload/);
  }, 120_000);

  it('no control named after the screen ⇒ unreachable, never a failure', async () => {
    const r = await run('/no-control');
    expect(r.verdict).toBe('unreachable');
    expect(r.note).toMatch(/no visible control named after the "design" screen/);
  }, 120_000);

  it('a destructive control that carries the word is never pressed', async () => {
    const r = await run('/trap');
    expect(r.verdict).toBe('unreachable');
  }, 120_000);
});
