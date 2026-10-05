// AUTOPSY e49afa97 (2026-10-01) — "App for old person help". The app was built, rendered, typechecked
// and pressed in a real browser, and the report still carried three false findings and one false line
// the user read:
//
// 1. INTEGRITY_FOCUS_CONFLICT — "3 components grab initial focus". Each `autoFocus` sat on an input
//    inside `{showForm && (<div role="dialog" aria-modal="true">…)}`: it takes focus when that dialog
//    OPENS, never at page load, so nothing was competing for the page's first focus.
// 2. JOURNEY_NOT_RUN — "none of the form fields were present on the running page", three times. The
//    forms were on screens the app switches by STATE (bottom nav), behind a "＋" icon button whose name
//    is its aria-label. The journey loaded `/` and never pressed either control.
// 3. The live timer said "this app is bigger than expected" at minute 4 of a build the user had been
//    told would take ~5–7 min, and which finished at 6.8 min — inside that band.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { liveEtaTick } from '../src/server/lib/BuildTimeEstimator';
import { readFileSync } from 'fs';
import { ReasoningRungStopError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { anotherLaneWorthTrying, upsellIsHonest } from '../src/server/AgentV3/laneFailure';
import { repeatedReadNotice } from '../src/server/AgentV3/repeatedReads';
import { analyzeProjectIntegrity, findFocusOwners } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { openTagsAt } from '../src/server/AgentV3/jsxTags';
import {
  deriveJourneys, journeyScript, parseJourneyResults, screenReachedByControl, TOOLS_DIR, type Journey,
} from '../src/server/AgentV3/journeyDerivation';
import { makeTempDir } from './helpers/tempDir';

const MIN = 60_000;

/** One of the report's three screens, in the shape the builder wrote it. */
const screen = (name: string, field: string, placeholder: string) => `import { useState } from 'react';
export default function ${name}() {
  const [items, setItems] = useState<string[]>(() => JSON.parse(localStorage.getItem('${name}') || '[]'));
  const [showForm, setShowForm] = useState(false);
  const [${field}, set${field}] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const next = [...items, ${field}];
    setItems(next);
    localStorage.setItem('${name}', JSON.stringify(next));
    setShowForm(false);
  };
  return (
    <div className="screen">
      <ul className="list">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      <button className="fab" onClick={() => setShowForm(true)} aria-label="Add ${name.toLowerCase()}">
        <span aria-hidden>＋</span>
      </button>

      {showForm && (
        <div
          className="nb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setShowForm(false)}
        >
          <form className="nb-modal senior-modal" onSubmit={add}>
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                name="${field}"
                value={${field}}
                onChange={(e) => set${field}(e.target.value)}
                placeholder="${placeholder}"
                required
                autoFocus
              />
            </label>
            <button type="submit">Save</button>
          </form>
        </div>
      )}
    </div>
  );
}
`;

const APP = `import { useState } from 'react';
import Home from './screens/Home';
import Medicines from './screens/Medicines';
import Contacts from './screens/Contacts';
import Tasks from './screens/Tasks';
export default function App() {
  const [tab, setTab] = useState('home');
  return (
    <main>
      {tab === 'home' && <Home />}
      {tab === 'medicines' && <Medicines />}
      {tab === 'contacts' && <Contacts />}
      {tab === 'tasks' && <Tasks />}
      <nav>
        <button onClick={() => setTab('home')}>🏠 Home</button>
        <button onClick={() => setTab('medicines')}>💊 Medicines</button>
        <button onClick={() => setTab('contacts')}>📞 Contacts</button>
        <button onClick={() => setTab('tasks')}>✅ Tasks</button>
      </nav>
    </main>
  );
}
`;

const FILES: Record<string, string> = {
  'src/App.tsx': APP,
  'src/screens/Home.tsx': 'export default function Home() { return <h1>Sahayak</h1>; }\n',
  'src/screens/Medicines.tsx': screen('Medicines', 'medName', 'e.g. Paracetamol'),
  'src/screens/Contacts.tsx': screen('Contacts', 'contactName', 'e.g. Ramesh'),
  'src/screens/Tasks.tsx': screen('Tasks', 'taskName', 'e.g. Walk'),
};

describe('🔴 an autoFocus inside a dialog is not the page\'s first focus', () => {
  it('the report\'s three screens no longer conflict', () => {
    expect(findFocusOwners(FILES)).toEqual([]);
    expect(analyzeProjectIntegrity(FILES).ok).toBe(true);
  });

  it.each([
    ['<dialog>', '<dialog open><input autoFocus /></dialog>'],
    ['role="alertdialog"', '<div role="alertdialog"><input autoFocus /></div>'],
    ['aria-modal', '<section aria-modal="true"><input autoFocus /></section>'],
    ['a modal class', '<div className="modal-card"><input autoFocus /></div>'],
    ['a Dialog component', '<Dialog.Content><input autoFocus /></Dialog.Content>'],
  ])('inside %s', (_l, jsx) => {
    const files = { 'src/A.tsx': `export const A = () => (${jsx});\n`, 'src/B.tsx': 'export const B = () => <input autoFocus />;\n' };
    expect(findFocusOwners(files).map((o) => o.file)).toEqual(['src/B.tsx']);
  });

  it('a dialog component\'s own file mounts when it opens', () => {
    const files = {
      'src/AddMedicineModal.tsx': 'export const M = () => <input autoFocus />;\n',
      'src/Search.tsx': 'export const S = () => <input autoFocus />;\n',
    };
    expect(findFocusOwners(files).map((o) => o.file)).toEqual(['src/Search.tsx']);
  });

  it('🔒 a page-level autoFocus is still an owner, and two of them still conflict', () => {
    const files = {
      'src/A.tsx': 'export const A = () => (<div className="page"><input autoFocus /></div>);\n',
      'src/B.tsx': 'export const B = () => (<div><div role="dialog"></div><input autoFocus /></div>);\n',
    };
    // B's dialog closed before its input, so B's input is on the page.
    expect(findFocusOwners(files).map((o) => o.file).sort()).toEqual(['src/A.tsx', 'src/B.tsx']);
    expect(analyzeProjectIntegrity(files).ok).toBe(false);
  });

  it('🔒 one file with a dialog autoFocus AND a page autoFocus is an owner', () => {
    const files = { 'src/A.tsx': 'export const A = () => (<><input autoFocus /><div role="dialog"><input autoFocus /></div></>);\n' };
    expect(findFocusOwners(files).map((o) => o.file)).toEqual(['src/A.tsx']);
  });

  it('openTagsAt names the elements still open at an offset, across lines', () => {
    const src = '<div className="a">\n  <form onSubmit={(e) => go(e)}>\n    <input autoFocus />\n  </form>\n</div>';
    const open = openTagsAt(src, src.indexOf('autoFocus'));
    expect(open.map((t) => t.slice(0, 5))).toEqual(['<div ', '<form']);
    const after = openTagsAt(src, src.indexOf('</div>'));
    expect(after.map((t) => t.slice(0, 5))).toEqual(['<div ']);
    expect(openTagsAt('<a/><b>x</b>', 11)).toEqual([]);
  });
});

describe('🔴 a screen no URL reaches is reached by its control', () => {
  it('each state-switched screen gets a journey that presses its nav control first', () => {
    const journeys = deriveJourneys({ files: FILES, routes: [], marker: 'MARK-1' });
    expect(journeys.map((j) => j.reach).sort()).toEqual(['contacts', 'medicines', 'tasks']);
    for (const j of journeys) {
      expect(j.route).toBe('/');
      expect(j.title).toMatch(/^Open the "\w+" screen/);
    }
  });

  it.each([
    ['src/screens/Medicines.tsx', '/', true],
    ['src/screens/Home.tsx', '/', false],
    ['src/pages/HomePage.tsx', '/', false],
    ['src/App.tsx', '/', false],
    ['src/screens/Medicines.tsx', '/medicines', false],
  ])('%s on %s → %s', (path, route, expected) => {
    expect(screenReachedByControl(path, route, FILES)).toBe(expected);
  });

  it('🔒 a screen a router declares keeps its URL and no reach', () => {
    const files = {
      ...FILES,
      'src/main.tsx': `import Medicines from './screens/Medicines';\n<Route path="/medicines" element={<Medicines />} />\n`,
    };
    expect(screenReachedByControl('src/screens/Medicines.tsx', '/', files)).toBe(false);
  });

  it('the runner asks every name a control goes by, and a lone plus opens a form', () => {
    const j: Journey = { id: 'x', kind: 'create-persists', route: '/', title: 't', writes: true, reach: 'medicines', fields: [{ target: { kind: 'placeholder', value: 'p' }, value: 'MARK-1' }], submit: { kind: 'text', value: 'Save' } };
    const script = journeyScript('http://x', [j], 'MARK-1');
    expect(script).toContain("await c.getAttribute('aria-label')");
    expect(script).toContain("await c.getAttribute('title')");
    expect(script).toContain('/^[+＋]$/.test(x)');
  });
});

describe('🔴 the timer never says "bigger than expected" inside the band it promised', () => {
  // The report: shown 5.1–6.9 min (308,692–412,984 ms); a plan-pace measurement re-anchored the total to
  // 4 min at minute 2; the plan saturated, and the next tick fell back to the countdown at minute 4.
  const promisedHigh = 412_984;

  it('at minute 4, with the total re-anchored to 4 min, it counts down to the promise instead', () => {
    const t = liveEtaTick(4 * MIN, 4 * MIN, 348_804, 0, promisedHigh);
    expect(t.text).not.toMatch(/bigger than|taking longer/);
    expect(t.text).toMatch(/~\d+ (?:min|s) to go/);
    expect(t.revised).toBe(false);
  });

  it('without the promise it is the overrun line — which is what the user read', () => {
    expect(liveEtaTick(4 * MIN, 4 * MIN, 348_804, 0).revised).toBe(true);
  });

  it('🔒 past the high end of the band, an overrun is a real overrun', () => {
    const t = liveEtaTick(7 * MIN, 4 * MIN, 348_804, 0, promisedHigh);
    expect(t.revised).toBe(true);
  });

  it('🔒 once a promise has been broken, the band no longer moves the line', () => {
    const t = liveEtaTick(4 * MIN, 3 * MIN, 348_804, 1, promisedHigh);
    expect(t.revised).toBe(true);
  });

  it('the route passes the band it showed', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('liveEtaTick(elapsedMs, etaTotalMs, etaBaseMs || etaTotalMs, etaRevisions, etaPromisedHighMs)');
    expect(route).toContain('etaPromisedHighMs = etaEvidenced || etaRoughBand ? Number(est.highMs) || 0 : 0;');
  });
});

const ROUTE = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const POOL = ['GLM', ...Array.from({ length: 50 }, (_, i) => `GLM#${i + 2}`)];

describe('🔴 after the fast lane hands off at a reasoning rung, no one-shot walks the same chain', () => {
  // The recording half (LLM_CALL_HANDED_OFF, `GLM ×51 keys`) and the crawl/bench half of this report are
  // owned by #3448 (autopsy d382b398, the same class). This PR keeps the part #3448 does not carry: the
  // one-shot ran 12 ms after the hand-off, reached the same rung, and wrote a second failure.
  const reason = new ReasoningRungStopError('kimi-k2.7-code', POOL).message;

  it('the hand-off is never a reason to try another lane, nor the app\'s fault', () => {
    expect(anotherLaneWorthTrying(reason)).toBe(false);
    expect(upsellIsHonest(reason)).toBe(false);
  });

  it('the route keeps the one-shot off the chain that just handed off, and says why', () => {
    expect(ROUTE).toMatch(/oneShotStillViable\(sb\) && anotherLaneWorthTrying\(sb\.reason\) && !fastLaneReasoningRung\)/);
    expect(ROUTE).toMatch(/classifyForOneShot\(analysis\?\.startTier\) && fastLaneReasoningRung\) \{\s*buildDiag\.record\(\{ phase: 'build', severity: 'info', code: 'ONESHOT_SKIPPED'/);
  });
});

describe('🔴 a file handed over in the task was not "read before"', () => {
  it('the first read of a handed file says where the copy came from', () => {
    const n = repeatedReadNotice('src/App.tsx', 2, true, 1, true);
    expect(n).toMatch(/given to you in full in your task/);
    expect(n).not.toMatch(/second time/);
  });
  it('🔒 a real second read keeps the old words, and a stalled loop still stops', () => {
    expect(repeatedReadNotice('src/App.tsx', 2, true, 1, false)).toMatch(/the second time/);
    expect(repeatedReadNotice('src/App.tsx', 4, true, 3, true)).toMatch(/^\[STOP/);
  });
});

// A REAL BROWSER, where one exists (the session container); skipped visibly in CI, which has none.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  // The report's shape: the Medicines screen is switched in by a nav button, and its form opens from an
  // icon button whose visible text is "＋" and whose name is its aria-label.
  const page = `<!doctype html><html lang="en"><head><title>Sahayak</title></head><body><div id="root">
<main id="screen"><h1>Sahayak</h1></main>
<nav><button id="home">🏠 Home</button><button id="meds">💊 Medicines</button></nav>
</div><script>
const KEY = 'meds';
const screen = document.getElementById('screen');
const list = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const showMeds = () => {
  screen.innerHTML = '<ul>' + list().map((m) => '<li>' + m + '</li>').join('') + '</ul>'
    + '<button id="fab" aria-label="Add medicine"><span aria-hidden="true">＋</span></button><div id="modal"></div>';
  document.getElementById('fab').onclick = () => {
    document.getElementById('modal').innerHTML = '<div role="dialog" aria-modal="true"><form id="f">'
      + '<input name="medName" placeholder="e.g. Paracetamol" autofocus><button type="submit">Save</button></form></div>';
    document.getElementById('f').onsubmit = (e) => {
      e.preventDefault();
      localStorage.setItem(KEY, JSON.stringify([...list(), e.target.medName.value]));
      showMeds();
    };
  };
};
document.getElementById('home').onclick = () => { screen.innerHTML = '<h1>Sahayak</h1>'; };
document.getElementById('meds').onclick = showMeds;
</script></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('🔴 opens the Medicines screen, presses "＋", saves a medicine and proves it survives a reload', async () => {
    const j: Journey = {
      id: 'j1', kind: 'create-persists', route: '/', title: 't', writes: true, reach: 'medicines',
      fields: [{ target: { kind: 'placeholder', value: 'e.g. Paracetamol' }, value: 'NBAI-MARK-9' }],
      submit: { kind: 'text', value: 'Save' },
    };
    const full = journeyScript(base, [j], 'NBAI-MARK-9');
    const body = full.slice(full.indexOf('\n') + 1, full.lastIndexOf('NBAI_EOF'))
      .replace(`import playwright from '${TOOLS_DIR}/node_modules/playwright/index.js';`, `import playwright from '${PW}';`);
    const dir = makeTempDir('nbai-journey-e49-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, body);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const [r] = parseJourneyResults(stdout);
    expect(r.note).toMatch(/still there after a reload/);
    expect(r.verdict).toBe('passed');
    expect((r as unknown as { opener?: string }).opener).toBe('Add medicine');
  }, 120_000);
});

describe('🔴 the release gate says why a journey was not reached, instead of guessing', () => {
  it('carries the runner\'s own reason, and never invents a login wall', async () => {
    const { releaseGate: judgeReleaseGate } = await import('../src/server/AgentV3/releaseGate');
    const base = { buildOk: true, preview: 'passed', pages: 'not-run', typecheck: 'passed', tests: 'not-run', journeys: 'unreachable' } as const;
    const NONE = { blockers: 0, highSeverity: 0, warnings: 0 };
    const withWhy = JSON.stringify(judgeReleaseGate({ ...base, journeyUnreachableWhy: 'none of the form fields were present on the running page' }, NONE));
    expect(withWhy).toContain('could not be reached (none of the form fields were present on the running page)');
    expect(withWhy).not.toContain('login wall');
    expect(JSON.stringify(judgeReleaseGate({ ...base }, NONE))).not.toContain('login wall');
  });
});
