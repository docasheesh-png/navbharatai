/**
 * Autopsy 5759ad8b (2026-10-01) — "Can you make this app" → a Kisaan Mandi Bhav app.
 *
 * 1. The sizers and the fast-lane planner read "Can you make this app" alone: the app it meant was described
 *    in the CHAT, which planningRequest drops by design (6ae30b33). A message whose subject is a pointer
 *    ("this app", "yeh app", "isko banao") now reads the conversation: its chat turns and its last answer.
 * 2. The journey check said the app's filters "act as you type … nothing needs changing", and the release
 *    gate still said "whether it keeps what a user enters is untested": the gate's predicate counted a tab
 *    bar of `onClick={() => setScreen('mandi')}` buttons as a way to save.
 * 3. A press that timed out was reported by the error's first line only; the call-log line naming WHY is
 *    now carried.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { refersToConversation, POINTER_MESSAGE_MAX_WORDS } from '../src/server/AgentV3/conversationReference';
import { planningRequest, planningContextNote } from '../src/server/AgentV3/planningRequest';
import { lastAssistantText } from '../src/server/AgentV3/ProjectContext';
import { complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import {
  appOnlyShowsWhatItHolds, appHasNoDataEntry, noJourneyReason, LOOKUP_ONLY_REASON,
  handlerOnlyChangesView, pressCanKeepInput,
} from '../src/server/AgentV3/journeyDerivation';
import { releaseGate } from '../src/server/AgentV3/releaseGate';
import { pressFailureNote, PRESS_FAILURE_CAUSE, clickExplorerModule } from '../src/server/AgentV3/clickExplorer';

// The conversation's last answer, in the shape the plain-chat lane stores (role + string content).
const REPLY = 'Kisaan Mandi Bhav app: Home screen with today\'s prices for wheat, rice, potato and tomato; a Mandi '
  + 'Bhav screen that filters crop prices by crop and district with min, max and modal price; a Mausam screen '
  + 'with a five-day weather forecast, humidity and wind; bottom navigation between the three screens.';

describe('1 · "this app" is sized from the conversation it points at', () => {
  it('recognises the pointer, in English, Romanised Hindi and Devanagari', () => {
    for (const p of [
      'Can you make this app', 'make this app', 'Build that website please', 'make it', 'build the same app',
      'yeh app bana do', 'ye wala app banao', 'isko banao', 'wahi bana dijiye', 'jo aapne bataya woh banao',
      'यह ऐप बना दो', 'इसे बनाओ',
    ]) expect(refersToConversation(p), p).toBe(true);
  });

  it('leaves alone a message that carries its own subject, and a long message with its own spec', () => {
    for (const p of [
      'build a notes app', 'ek billing app banao', 'make a todo list', 'Create a calculator',
      'hi', '', 'make it dark mode with a sidebar, a settings page, user login, a profile page and charts for sales',
    ]) expect(refersToConversation(p), p).toBe(false);
    expect('make it dark mode with a sidebar, a settings page, user login, a profile page and charts for sales'.split(/\s+/).length)
      .toBeGreaterThan(POINTER_MESSAGE_MAX_WORDS);
  });

  it('reads the chat turns and the last answer for a pointer; the planner text names the real app', () => {
    const plan = planningRequest({
      prompt: 'Can you make this app',
      recentTurns: [{ text: 'kisaan ke liye mandi bhav dekhne wala app kaisa hoga?', lane: 'chat' }],
      conversationReply: REPLY,
      userAppExists: false,
    });
    expect(plan.sources).toEqual(['earlier-requests', 'conversation']);
    expect(plan.text).toContain('mandi bhav dekhne wala app');
    expect(plan.text).toContain('five-day weather forecast');
    expect(planningContextNote(plan, 'Can you make this app'.length)).toMatch(/last answer/);
    // The bare message scores as nothing; the request the builder acted on does not.
    const bare = complexityFromPrompt('Can you make this app');
    const read = complexityFromPrompt(plan.text);
    expect((read.featureCount ?? 0) + (read.moduleCount ?? 0)).toBeGreaterThan((bare.featureCount ?? 0) + (bare.moduleCount ?? 0));
  });

  it('🔒 6ae30b33 still holds: without a pointer a chat turn is conversation, not a spec, and the answer is ignored', () => {
    const plan = planningRequest({
      prompt: 'Make question',
      recentTurns: [{ text: 'swimming par hindi nibandh likho', lane: 'chat' }],
      conversationReply: 'Here is an essay on swimming …',
      userAppExists: false,
    });
    expect(plan.sources).toEqual([]);
    expect(plan.text).toBe('Make question');
  });

  it('a finished app is not re-sized from the chat ("make this app dark" is an edit of the app on disk)', () => {
    const plan = planningRequest({
      prompt: 'make this app dark',
      recentTurns: [{ text: 'what colours suit a shop?', lane: 'chat' }],
      conversationReply: REPLY,
      userAppExists: true,
    });
    expect(plan.sources).toEqual([]);
  });

  it('lastAssistantText returns the last answer whole (the recap cuts turns to 280 characters)', () => {
    const messages = [
      { role: 'user', content: 'mandi app ke baare me batao' },
      { role: 'assistant', content: REPLY + ' '.repeat(10) + 'x'.repeat(400) },
      { role: 'user', content: 'Can you make this app' },
    ];
    const got = lastAssistantText(messages);
    expect(got.startsWith('Kisaan Mandi Bhav app')).toBe(true);
    expect(got.length).toBeGreaterThan(280);
    expect(lastAssistantText([{ role: 'assistant', content: [{ type: 'tool_use', name: 'x' }, { type: 'text', text: 'done' }] }])).toBe('done');
    expect(lastAssistantText([{ role: 'user', content: 'hi' }])).toBe('');
    expect(lastAssistantText([{ role: 'assistant', content: 'y'.repeat(50) }], 10)).toHaveLength(10);
  });

  it('🔒 the route reads the last answer only for a pointer on a workspace with no finished app, and passes it in', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/const conversationReply = \(!userAppExists \|\| appStillUnbuilt\) && refersToConversation\(prompt\)/);
    expect(src).toContain('lastAssistantText((rec as { messages?: unknown[] } | null)?.messages ?? [], CONVERSATION_REPLY_MAX)');
    expect(src).toMatch(/planningRequest\(\{[^}]*conversationReply[^}]*\}\)/);
  });
});

// The shape of the shipped app (from the report: three screens, a bottom tab bar, filters over sample data).
const mandiApp: Record<string, string> = {
  'src/App.tsx': `import { useState } from 'react';
function App() {
  const [screen, setScreen] = useState<Screen>('home');
  return (<div className="app-shell"><main className="app-main">{screen === 'home' && <HomeScreen />}</main>
    <nav className="bottom-nav">
      <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>🏠 Home</button>
      <button className={screen === 'mandi' ? 'active' : ''} onClick={() => setScreen('mandi')}>🌾 Mandi Bhav</button>
      <button className={screen === 'weather' ? 'active' : ''} onClick={() => setScreen('weather')}>🌤️ Mausam</button>
    </nav></div>);
}
export default App;`,
  'src/screens/MandiScreen.tsx': `function MandiScreen() {
  const [crop, setCrop] = useState('All');
  const [district, setDistrict] = useState('Lucknow');
  const rows = useMemo(() => getPrices(crop, district), [crop, district]);
  return (<div className="container"><h1>Mandi Bhav</h1>
    <label htmlFor="crop">Crop</label>
    <select id="crop" value={crop} onChange={(e) => setCrop(e.target.value)}>{CROPS.map((c) => <option key={c}>{c}</option>)}</select>
    <label htmlFor="district">District</label>
    <select id="district" value={district} onChange={(e) => setDistrict(e.target.value)}>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select>
    {rows.length === 0 ? <div className="nb-empty">No prices</div> : rows.map((r) => <div key={r.crop}>{r.crop}</div>)}
  </div>);
}`,
  'src/data/mandi.ts': "export const CROPS = ['Wheat', 'Rice'] as const;\nexport function getPrices(c: string, d: string) { return []; }",
  'src/ErrorBoundary.tsx': 'class ErrorBoundary { render() { return <button onClick={() => this.setState({ error: null })}>Try again</button>; } }',
};

describe('2 · a tab bar is not a way to save', () => {
  it('the mandi app only shows what it holds — the gate and the journey sentence now agree', () => {
    expect(appHasNoDataEntry(mandiApp)).toBe(false);          // it has selects — the old question, answered as before
    expect(appOnlyShowsWhatItHolds(mandiApp)).toBe(true);
    expect(noJourneyReason(mandiApp)).toBe(LOOKUP_ONLY_REASON);
  });

  it('a view-only handler is recognised; anything that could keep input is not', () => {
    for (const h of ["() => setScreen('mandi')", '() => setOpen(!open)', '() => setActiveTab(tab.id)', "() => navigate('/home')",
      '() => setTheme((t) => !t)', "() => { setScreen('home'); }", '() => setCount(0)']) expect(handlerOnlyChangesView(h), h).toBe(true);
    for (const h of ['add', '() => addCrop(name)', '() => setItems([...items, text])', '() => save()', '() => setCount((c) => c + 1)',
      '() => setItems(next)', "() => { setScreen('a'); save(); }", '() => remove(row.id)']) expect(handlerOnlyChangesView(h), h).toBe(false);
  });

  it('🔒 precision: any press that could keep input keeps the old, conservative answer', () => {
    const withIt = (src: string) => ({ ...mandiApp, 'src/components/X.tsx': src });
    expect(appOnlyShowsWhatItHolds(withIt('<button onClick={() => addCrop(name)}>+</button>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('<button onClick={() => setItems([...items, x])}>Go</button>'))).toBe(false);
    expect(appOnlyShowsWhatItHolds(withIt('<button className="x">Go</button>'))).toBe(false);   // no handler to judge
    expect(appOnlyShowsWhatItHolds(withIt('<button onClick={() => setScreen("x")}>Add</button>'))).toBe(false); // label reads as adding
    expect(appOnlyShowsWhatItHolds(withIt('<div onClick={save}/>'))).toBe(false);
    expect(pressCanKeepInput('<button onClick={() => setScreen(\'home\')}>Home</button>')).toBe(false);
  });

  it('the gate no longer calls it untested: pressing its controls is its journey (GREEN only with nothing worth a look)', () => {
    const base = { buildOk: true, preview: 'passed', typecheck: 'passed', journeys: 'none-derivable', explore: 'passed', explorePresses: 2 } as const;
    const yellow = releaseGate(base as never, { blockers: 0, highSeverity: 0, warnings: 1 });
    expect(yellow.state).toBe('yellow');
    expect(yellow.headline).toMatch(/pressing its controls held up/);
    expect(yellow.headline).not.toMatch(/untested/);
    const green = releaseGate(base as never, { blockers: 0, highSeverity: 0, warnings: 0 });
    expect(green.state).toBe('green');
    expect(green.headline).toMatch(/nothing to save/);
    // What the report said, for contrast: the same app read as a data app.
    const before = releaseGate({ ...base, journeys: undefined } as never, { blockers: 0, highSeverity: 0, warnings: 1 });
    expect(before.headline).toMatch(/keeps what a user enters is untested/);
  });
});

describe('3 · a press that could not complete says why', () => {
  const log = 'locator.click: Timeout 4000ms exceeded.\nCall log:\n  - waiting for locator(\'[data-nbai-x="2"]\').first()\n'
    + '  - attempting click action\n  - <nav class="bottom-nav">…</nav> intercepts pointer events\n  - retrying click action';

  it('carries the call-log line that names the cause', () => {
    const note = pressFailureNote('could not be pressed: ', log, PRESS_FAILURE_CAUSE.source, PRESS_FAILURE_CAUSE.flags);
    expect(note).toBe('could not be pressed: locator.click: Timeout 4000ms exceeded. — <nav class="bottom-nav">…</nav> intercepts pointer events');
  });

  it('with no named cause it is the first line, as before', () => {
    expect(pressFailureNote('could not be used: ', 'Timeout 4000ms exceeded.', PRESS_FAILURE_CAUSE.source, PRESS_FAILURE_CAUSE.flags))
      .toBe('could not be used: Timeout 4000ms exceeded.');
  });

  it('🔒 the runner embeds this function by value and uses it for both kinds of skip', () => {
    const mod = clickExplorerModule({ causeSrc: PRESS_FAILURE_CAUSE.source, causeFlags: PRESS_FAILURE_CAUSE.flags }, 'const chromium = null;');
    expect(mod).toMatch(/const pressFailureNote = function pressFailureNote\(/);
    // Since autopsy 8b8743a3 both lanes route their failure through ONE judge, which writes the note —
    // so the cause line still reaches both, and the coverage probe cannot reach only one of them.
    expect(mod).toContain("res.note = pressFailureNote(prefix, message, cfg.causeSrc, cfg.causeFlags)");
    expect(mod).toContain("judgeFailedPress(page, res, 'data-nbai-x', marked, String(e && e.message || e), 'could not be pressed: ')");
    expect(mod).toContain("judgeFailedPress(page, res, 'data-nbai-n', marked, String(e && e.message || e), 'could not be used: ')");
    expect(mod).not.toMatch(/'could not be pressed: ' \+ String/);
  });
});
