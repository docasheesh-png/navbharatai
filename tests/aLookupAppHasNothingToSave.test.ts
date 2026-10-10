/**
 * Autopsy ee0e6de5 (2026-09-30) — "Build an app with the world's total countries and their capitals",
 * written in Devanagari. One screen: a search box, an A–Z / Z–A sort, a static table of 195 rows.
 *
 * What went wrong, and what each block below locks:
 *  1. The complexity classifier called it COMPLEX (a big DATA list read as a big APP), so the build
 *     opened on the reasoning rung, skipped the fast lane, and took 6.5 min against a 2–4 min estimate.
 *  2. The release gate said "whether it actually SAVES anything is untested" about an app that has
 *     nothing to save, and told the user its fields needed a `name` for a check that had nothing to prove.
 *  3. "Its individual page routes were never render-checked" — about an app with no routes.
 *  4. The live tick repeated "rough estimate ~2–4 min" at minute 6.
 *  5. The Frontend sub-agent read `src/index.css` six times in slices to learn the kit's class names,
 *     which the architect had been told and it had not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { complexityPrompt } from '../src/server/AgentV3/complexityRouting';
import {
  appOnlyShowsWhatItHolds, appHasNoDataEntry, noJourneyReason, LOOKUP_ONLY_REASON,
} from '../src/server/AgentV3/journeyDerivation';
import { releaseGate, whyMissing, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { unevidencedEtaTickLine } from '../src/server/AgentV3/etaEvidence';
import { stylesheetCarriesKit } from '../src/server/AgentV3/kitRestore';
import { DESIGN_KIT_BRIEF, architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import {
  writeTypecheckWarmupCommand, WARMUP_COMPILED_MARKER, writeTypecheckCommand, WriteTypecheckQueue, WRITE_TYPECHECK_TSBUILDINFO,
  writeTypecheckSummary, emptyWriteTypecheckStats, writeTypecheckUntouched,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

// The app as that build wrote it, reduced to the parts the predicates read.
const countriesApp: Record<string, string> = {
  'src/App.tsx': `import { useMemo, useState } from "react";
import { countries } from "./data/countries";
import { SearchBar } from "./components/SearchBar";
import { SortSelect } from "./components/SortSelect";
export default function App() {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const shown = useMemo(() => countries.filter((c) => c.name.includes(query)), [query]);
  return (<main className="container"><SearchBar value={query} onChange={setQuery} />
    <SortSelect value={order} onChange={setOrder} /><CountryTable rows={shown} /></main>);
}`,
  'src/components/SearchBar.tsx': `export function SearchBar({ value, onChange }: Props) {
  return (<label className="field">खोजें
    <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </label>);
}`,
  'src/components/SortSelect.tsx': `export function SortSelect({ value, onChange }: Props) {
  return (<label className="field">क्रम<select value={value} onChange={(e) => onChange(e.target.value as SortOrder)}>
    <option value="asc">A-Z</option><option value="desc">Z-A</option></select></label>);
}`,
  'src/data/countries.ts': 'export const countries = [{ name: "India", capital: "New Delhi" }];',
  // Files the platform adds, which must not be read as the app's own save paths.
  'src/ErrorBoundary.tsx': 'class ErrorBoundary { static getDerivedStateFromError() {} render() { return <button onClick={() => this.setState({ error: null })}>Try again</button>; } }',
  'public/sw.js': "caches.open(CACHE).then((c) => c.put(req, copy));",
  'e2e/smoke.spec.ts': "await page.locator('button').first().click(); localStorage.clear();",
  'playwright.config.ts': 'export default { use: { baseURL } };',
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
};

describe('1 · a long list of fixed facts is a simple app', () => {
  it('the classifier is told that data volume is not app size, and that doubt means simple', () => {
    const p = complexityPrompt('Build an app वेयर वर्ल्ड\'एस टोटल कंट्रीज नेम विथ थेइर कैपिटल्स');
    expect(p).toMatch(/FIXED facts/);
    expect(p).toMatch(/all countries and capitals/);
    expect(p).toMatch(/If unsure, answer "simple"/);
    // Still a label, not an essay — it is billed per token.
    expect(complexityPrompt('build me a shop').length).toBeLessThan(900);
  });
});

describe('2 · a lookup app has no save to prove', () => {
  it('the countries app is lookup-only, although it has an input and a change handler', () => {
    expect(appHasNoDataEntry(countriesApp)).toBe(false);   // the old question, still answered the old way
    expect(appOnlyShowsWhatItHolds(countriesApp)).toBe(true);
  });

  it('any sign of a way to save keeps it a data app (conservative)', () => {
    const withIt = (path: string, src: string) => ({ ...countriesApp, [path]: src });
    expect(appOnlyShowsWhatItHolds(withIt('src/components/Add.tsx', '<button>Add</button>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/components/Add.tsx', '<Button>Add</Button>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/components/Add.tsx', '<form><input name="t"/></form>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/components/Add.tsx', '<input onKeyDown={add}/>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/components/Add.tsx', '<div onClick={add}/>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/store.ts', 'localStorage.setItem("k", v)'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/api.ts', 'fetch(url, { method: "POST" })'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/api.ts', 'await supabase.from("t").insert(row)'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/api.ts', 'await addDoc(col, row)'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('src/Note.tsx', '<textarea/>'))).toBe(false);
  });

  it('needs a control at all — an app with no input is the other predicate\'s case, not this one', () => {
    expect(appOnlyShowsWhatItHolds({ 'src/App.tsx': '<main><h1>Hi</h1></main>' })).toBe(false);
    expect(appOnlyShowsWhatItHolds({})).toBe(false);
    // An input nothing listens to is an unwired field, not a filter.
    expect(appOnlyShowsWhatItHolds({ 'src/pages/A.tsx': '<input className="x" />' })).toBe(false);
  });

  it('the explanation names the real reason instead of asking for field names', () => {
    expect(noJourneyReason(countriesApp)).toBe(LOOKUP_ONLY_REASON);
    expect(noJourneyReason(countriesApp)).not.toMatch(/Give each field a `name`/);
  });

  it('the gate reads it as none-derivable: neutral wording, still never green', () => {
    const ev: RuntimeEvidence = {
      buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'none-derivable',
      typecheck: 'passed', tests: 'not-run', testSuiteIsOurStarter: true, noPageRoutes: true,
    };
    const v = releaseGate(ev, { blockers: 0, highSeverity: 0, warnings: 0 });
    expect(v.state).toBe('yellow');
    expect(v.headline).not.toMatch(/SAVES/);
  });

  it('🔒 the route marks a lookup app none-derivable, and derives page routes from the whole project', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    // The window allows the block this became when the gate was also given the derivation's own
    // sentence (autopsy 536c8189) — the pin is on the DECISION, not on it being one line.
    expect(src).toMatch(/appHasNoDataEntry\(journeyFiles\) \|\| appOnlyShowsWhatItHolds\(journeyFiles\)\)[\s\S]{0,120}gateEvidence\.journeys = 'none-derivable'/);
    expect(src).toMatch(/const pageRoutes = extractPageRoutes\(\{ \.\.\.\(projectFilesAtTurnStart \?\? \{\}\), \.\.\.Object\.fromEntries\(writtenFiles\) \}\)/);
    expect(src).not.toMatch(/extractPageRoutes\(Object\.fromEntries\(writtenFiles\)\)/);
    expect(src).toMatch(/if \(pageRoutes\.length === 0\) gateEvidence\.noPageRoutes = true;/);
  });
});

describe('3 · an app with no routes is not told its routes went unchecked', () => {
  const base: RuntimeEvidence = {
    buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'not-run', typecheck: 'passed', tests: 'not-run',
  };
  it('says no routes were found, and that it cannot see router-less screens', () => {
    const why = whyMissing('pages', { ...base, noPageRoutes: true });
    expect(why).toMatch(/no separate page routes were found/);
    expect(why).toMatch(/without a router are not reached/);
  });
  it('without the fact, the old sentence is unchanged', () => {
    expect(whyMissing('pages', base)).toBe('the app came up, but its individual page routes were never render-checked here');
  });
  it('the fact never changes a verdict', () => {
    const f = { blockers: 0, highSeverity: 0, warnings: 0 };
    expect(releaseGate({ ...base, noPageRoutes: true }, f).state).toBe(releaseGate(base, f).state);
  });
});

describe('4 · the live tick stops restating an estimate the build has outrun', () => {
  const band = '~2–4 min';
  const high = 256_040;              // the report's own highMs
  const budget = 1_740_000;          // 29 min
  it('inside the band, the labelled guess is shown as before', () => {
    const line = unevidencedEtaTickLine(4 * 60_000, budget, band, high);
    expect(line).toContain(`rough estimate ${band} (`);
  });
  it('past the band, it says the guess was too low instead of repeating it', () => {
    const line = unevidencedEtaTickLine(6 * 60_000, budget, band, high);
    expect(line).toMatch(/past my rough estimate of ~2–4 min, which was a guess and was too low/);
    expect(line).not.toContain(`rough estimate ${band} (`);
  });
  it('a caller that passes no top end keeps the old line exactly', () => {
    expect(unevidencedEtaTickLine(6 * 60_000, budget, band)).toBe(unevidencedEtaTickLine(6 * 60_000, budget, band, null));
    expect(unevidencedEtaTickLine(6 * 60_000, budget, band)).toContain(`rough estimate ${band} (`);
  });
  it('🔒 the route passes the band\'s top end to the tick', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/unevidencedEtaTickLine\(elapsedMs, effectiveBuildSeconds \* 1000, etaRoughBand, etaRoughHighMs\)/);
  });
});

describe('5 · a writing sub-agent is told the kit, as the architect is', () => {
  it('the kit stylesheet is recognised; an ordinary stylesheet is not', () => {
    expect(stylesheetCarriesKit(DESIGN_KIT_CSS)).toBe(true);
    expect(stylesheetCarriesKit('body { margin: 0 } .title { color: red }')).toBe(false);
    expect(stylesheetCarriesKit('')).toBe(false);
  });
  it('the architect prompt still carries the same brief, word for word', () => {
    const prompt = architectSystemPrompt('vite-react');
    expect(prompt).toContain(DESIGN_KIT_BRIEF.join('\n'));
    expect(DESIGN_KIT_BRIEF.join('\n')).toMatch(/\.nb-table/);
  });
  it('🔒 SubAgent hands the brief over only when the stylesheet carries the kit', () => {
    const src = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    expect(src).toMatch(/if \(roleExpectsArtifacts\(cfg\.tools\)\)/);
    expect(src).toMatch(/stylesheetCarriesKit\(withoutPreviewBridge\('src\/index\.css', raw\)\)/);
    expect(src).toMatch(/DESIGN_KIT_BRIEF\.join\('\\n'\)/);
  });
});

describe('6 · the first write-time typecheck reads a warm cache, not a cold compile', () => {
  it('the warm-up never installs, discards its output, and fills the one shared cache', () => {
    const cmd = writeTypecheckWarmupCommand();
    expect(cmd).not.toMatch(/npm install/);
    expect(cmd).toContain(WRITE_TYPECHECK_TSBUILDINFO);
    expect(cmd).toContain('>/dev/null 2>&1');
    expect(cmd).toMatch(/\[ -x node_modules\/\.bin\/tsc \]/);
    expect(cmd).toMatch(/\[ ! package\.json -nt node_modules \]/);
    // The real check still ensures its compiler — only the background warm-up must not.
    expect(writeTypecheckCommand()).toMatch(/npm install/);
  });

  it('the queue reports idle only with nothing running and nothing waiting', async () => {
    const q = new WriteTypecheckQueue<number>();
    expect(q.idle()).toBe(true);
    let release!: () => void;
    const first = q.run(() => new Promise<number>((r) => { release = () => r(1); }));
    expect(q.idle()).toBe(false);
    const second = q.run(async () => 2);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(q.idle()).toBe(true);
  });

  const TSC_ERR = `src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.`;
  class Act implements ActuatorPort {
    files = new Map<string, string>([['tsconfig.json', '{}']]);
    commands: string[] = [];
    releaseWarmup: (() => void) | null = null;
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand(_w: string, cmd: string) {
      this.commands.push(cmd);
      // The warm-up now names this dispatcher's own cache (TD-18), not the shared default.
      if (/--tsBuildInfoFile \/tmp\/agentv3-[A-Za-z0-9]+\.tsbuildinfo >\/dev\/null 2>&1; echo NBAI_WARMUP_COMPILED/.test(cmd)) {
        await new Promise<void>((r) => { this.releaseWarmup = r; });
        // The marker the warm-up prints only when it really compiled (autopsy 8257ca59).
        return { exitCode: 0, stdout: `${WARMUP_COMPILED_MARKER}\n`, stderr: '' };
      }
      return /\btsc\b/.test(cmd) ? { exitCode: 2, stdout: TSC_ERR, stderr: '' } : { exitCode: 0, stdout: '', stderr: '' };
    }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }

  it('runs once per build, is never evidence, and a write arriving mid-warm-up still gets its own verdict', async () => {
    const act = new Act();
    const stream = new AgentEventStream();
    const recorded: string[] = [];
    const d = new ToolDispatcher(act, 'ws-warm', new WorkspaceState(stream), stream,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      (c) => { recorded.push(c.command); });
    d.warmTypecheckCache();
    d.warmTypecheckCache(); // a second call is a no-op
    // Old: the warm-up was the shared default `writeTypecheckWarmupCommand()`.
    // New: it is that command with this dispatcher's own cache id, still exactly once.
    const warmups = act.commands.filter((c) =>
      /--tsBuildInfoFile \/tmp\/agentv3-[A-Za-z0-9]+\.tsbuildinfo >\/dev\/null 2>&1; echo NBAI_WARMUP_COMPILED/.test(c));
    expect(warmups).toHaveLength(1);
    expect(warmups[0]).not.toContain('--tsBuildInfoFile ' + '/tmp/agentv3' + '.tsbuildinfo');

    const write = d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/a.ts', content: 'export const a: number = "x";' } }, 'architect');
    await new Promise((r) => setTimeout(r, 20));
    act.releaseWarmup?.();
    const text = String((await write).content);
    expect(text).toContain('TS2322');                       // the write's own compile ran after the warm-up
    const s = d.writeTypecheckStats();
    expect(s.warmupStarted).toBe(true);
    expect(s.warmupMs).not.toBeNull();
    expect(s.runs).toBe(1);                                 // the warm-up is not a run
    expect(recorded.some((c) => warmups.includes(c))).toBe(false); // nor typecheck evidence
  });

  it('a warm-up alone never makes the stats "touched", and the summary says the cache was warmed', () => {
    const warmed = { ...emptyWriteTypecheckStats(), warmupStarted: true, warmupMs: 14_600 };
    expect(writeTypecheckUntouched(warmed)).toBe(true);
    const ran = writeTypecheckSummary({ ...warmed, runs: 3, cleanRuns: 2, elapsedMs: 3000 }, true, 5);
    expect(ran).toContain('the cache was warmed at build start in 15s, before the first write');
    expect(writeTypecheckSummary({ ...emptyWriteTypecheckStats(), runs: 3, cleanRuns: 2, elapsedMs: 3000 }, true, 5)).not.toContain('warmed');
  });

  it('🔒 the route warms it only on a turn that writes code', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/if \(\(intent === 'new_build' \|\| intent === 'edit_existing'\) && !isImportTurn\) dispatcher\.warmTypecheckCache\(\);/);
  });
});
