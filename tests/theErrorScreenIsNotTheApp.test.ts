import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePreviewHtml, scaffoldCrashScreen } from '../src/server/AgentV3/PreviewVerify';
import { errorBoundaryTsx } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import {
  unusablePlanCause, projectPlanUnusableMessage, roadmapUnparseableDetail,
  PROJECT_MODE_FALLBACK_NARRATION, PROJECT_MODE_ONE_GO_NARRATION,
} from '../src/server/AgentV3/projectPlannerBudget';
import { findStoreEffectLoops, storeEffectLoopNote } from '../src/server/AgentV3/storeEffectLoop';

/**
 * Autopsy 6a4a799f (2026-09-29) — "Blue Berry", a music app on the Weak tier. It first "rendered" as its
 * own error screen and was saved as the last known good; five of its twenty-four minutes went to a
 * project plan that was cut off and never mentioned; a line saying "Resume playback" made it a jobs app;
 * and the whole-store render loop that broke it was a shape a write-time note can see.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// The fallback as React's DOM serialises it (inline styles become style="…").
const CRASH_HTML = `<!doctype html><html><head><title>Blue Berry</title></head><body><div id="root"><div style="padding: 24px; font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto;"><h1 style="font-size: 20px; margin-bottom: 8px;">Something went wrong</h1><p style="color: rgb(102, 102, 102); margin-bottom: 16px;">Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.</p><button style="padding: 8px 16px; cursor: pointer;">Try again</button></div></div><a href="https://navbharatai.com">made by NavBharatAI</a></body></html>`;

describe('our own error screen is a crashed app, never a rendered one', () => {
  it('is judged NOT rendered, conclusively, with the error it shows', () => {
    const v = analyzePreviewHtml(CRASH_HTML, { painted: true, source: 'browser' });
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBeFalsy();
    expect(v.serverDown).toBeFalsy();
    expect(v.problems.join(' ')).toMatch(/crashed and is showing its error screen/);
    expect(v.problems.join(' ')).toMatch(/Maximum update depth exceeded/);
  });

  it('is positive evidence even from a capture that could not otherwise see the app', () => {
    expect(analyzePreviewHtml(CRASH_HTML, { painted: false, source: 'browser' }).rendered).toBe(false);
  });

  it("an app's own designed error card is not mistaken for a crash", () => {
    const html = '<div id="root"><main><h2>Top songs</h2><div class="card"><p>Something went wrong. Try again</p><button>Try again</button></div><ul><li>Song A</li></ul></main></div>';
    expect(scaffoldCrashScreen(html)).toBeNull();
    expect(analyzePreviewHtml(html, { painted: true, source: 'browser' }).rendered).toBe(true);
  });

  it('the detector and the scaffold cannot drift: heading, message, then button, in that order', () => {
    const h1 = errorBoundaryTsx.indexOf('>Something went wrong</h1>');
    const p = errorBoundaryTsx.indexOf('{this.state.error.message}</p>');
    const btn = errorBoundaryTsx.indexOf('Try again');
    expect(h1).toBeGreaterThan(0);
    expect(p).toBeGreaterThan(h1);
    expect(btn).toBeGreaterThan(p);
  });
});

describe('"Resume playback" is a player control, not a CV', () => {
  const prompt = read('tests/fixtures/blueBerryPrompt.txt');

  it('the Blue Berry prompt is not a jobs app', () => {
    expect(analyzeRequirementGaps(prompt).domain).not.toBe('jobs');
    expect(analyzeRequirementGaps('- Resume playback\n- Queue').domain).not.toBe('jobs');
    expect(analyzeRequirementGaps('downloads with pause/resume and cancel').domain).not.toBe('jobs');
  });

  it('a real CV still means a jobs app', () => {
    expect(analyzeRequirementGaps('a job portal where candidates upload their resume').domain).toBe('jobs');
    expect(analyzeRequirementGaps('resume builder app').domain).toBe('jobs');
  });
});

describe('a product named in a prohibition is not a clone request', () => {
  it('"Do NOT use copyrighted Spotify assets" is not a Spotify clone', () => {
    expect(analyzeAppScope('Do NOT use copyrighted Spotify assets or branding').famousApp).toBeNull();
    expect(analyzeAppScope(read('tests/fixtures/blueBerryPrompt.txt')).famousApp).toBeNull();
  });

  it('a likeness request still escalates, even beside a negation', () => {
    expect(analyzeAppScope('make a Spotify clone').famousApp).toBe('Spotify');
    expect(analyzeAppScope("I don't want a basic app, make a Spotify clone").famousApp).toBe('Spotify');
    expect(analyzeAppScope("don't copy it, but make it like Spotify").famousApp).toBe('Spotify');
  });
});

describe('a planner answer that cannot be used is said as a failure', () => {
  it('names the cause: cut off, unreadable, or genuinely too small', () => {
    expect(unusablePlanCause({ modules: 0, stopReason: 'max_tokens', responseChars: 16352 })).toBe('cut-off');
    expect(unusablePlanCause({ modules: 0, stopReason: 'end_turn', responseChars: 400 })).toBe('unreadable');
    expect(unusablePlanCause({ modules: 2, stopReason: 'end_turn', responseChars: 900 })).toBe('too-small');
  });

  it('the admin line carries the seconds it cost', () => {
    const m = projectPlanUnusableMessage({ cause: 'cut-off', modules: 0, responseChars: 16352, latencyMs: 300_012, min: 3 });
    expect(m).toMatch(/cut off/);
    expect(m).toMatch(/300s/);
  });

  it('the user hears the right withdrawal, and no engine is named', () => {
    for (const t of [PROJECT_MODE_FALLBACK_NARRATION, PROJECT_MODE_ONE_GO_NARRATION]) {
      expect(t).not.toMatch(/glm|kimi|claude|nemotron|nvidia|gemini|grok|sonnet|opus/i);
    }
  });

  it('a cut-off roadmap says so', () => {
    expect(roadmapUnparseableDetail({ stopReason: 'end_turn', text: '{"steps":[{"title":"a"' })).toMatch(/cut off/);
    expect(roadmapUnparseableDetail({ stopReason: 'end_turn', text: 'no json here' })).toMatch(/no JSON object/);
  });

  it('the route records it and withdraws the promise (source guard)', () => {
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf('const cause = unusablePlanCause(');
    expect(at).toBeGreaterThan(0);
    const block = route.slice(at, at + 1400);
    expect(block).toContain("code: cause === 'too-small' ? 'PROJECT_MODE_STOOD_DOWN' : 'PROJECT_MODE_FAILED'");
    expect(block).toContain('PROJECT_MODE_FALLBACK_NARRATION');
    expect(route).toContain('rejected.push(roadmapUnparseableDetail(');
  });
});

describe('an effect on the whole store that writes to it is caught while the file is open', () => {
  const LAYOUT = `import { useEffect } from 'react';
import { useMusicStore } from '../stores/useMusicStore';
export function Layout() {
  const store = useMusicStore();
  useEffect(() => {
    store.init();
  }, [store]);
  return <div>{store.unreadCount()}</div>;
}
`;

  it('finds the Blue Berry shape', () => {
    const f = findStoreEffectLoops('src/components/Layout.tsx', LAYOUT);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ name: 'store', hook: 'useMusicStore', action: 'init', line: 5 });
    const note = storeEffectLoopNote({ 'src/components/Layout.tsx': LAYOUT });
    expect(note).toMatch(/RENDER LOOP/);
    expect(note).toMatch(/useMusicStore\(\(s\) => s\.init\)/);
  });

  it('stays quiet on the correct forms', () => {
    const selected = LAYOUT.replace('const store = useMusicStore();', 'const init = useMusicStore((s) => s.init);\n  const store = { init, unreadCount: () => 0 };');
    expect(findStoreEffectLoops('a.tsx', selected)).toHaveLength(0);
    const readOnly = LAYOUT.replace('store.init();', 'console.log(store);');
    expect(findStoreEffectLoops('a.tsx', readOnly)).toHaveLength(0);
    const memberDep = LAYOUT.replace('[store]', '[store.initialized]');
    expect(findStoreEffectLoops('a.tsx', memberDep)).toHaveLength(0);
    expect(findStoreEffectLoops('a.test.tsx', LAYOUT)).toHaveLength(0);
    expect(findStoreEffectLoops('a.css', LAYOUT)).toHaveLength(0);
  });

  it('never throws on junk, and the kill switch silences it', () => {
    expect(findStoreEffectLoops('a.tsx', 'useEffect(( ')).toEqual([]);
    expect(storeEffectLoopNote({ 'a.tsx': LAYOUT }, { AGENTV3_STORE_LOOP_NOTE: 'off' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('reaches every write tool through the one steering-note door (source guard)', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('storeLoop = storeEffectLoopNote(files)');
    // 466c260a appended the invented-kit-class note after `quality` — the store note is still returned.
    expect(d).toContain('return hooks + storeLoop + imports + typecheck + quality + invented + security + shadow;');
  });
});
