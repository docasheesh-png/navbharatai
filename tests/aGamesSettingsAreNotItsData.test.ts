/**
 * BUILD 46e2d74b (admin 2026-10-11) — the racing game was judged like a FORM.
 *
 * Its report said JOURNEY_NOT_DERIVED and the release gate came out YELLOW, "whether it keeps what a user
 * enters is untested" — about a game, which by the platform's own definition (NO_DATA_ENTRY_REASON) has
 * nothing to save. The data-entry check counted any `<input>` except a literal QUOTED type, so a game's
 * sound checkbox, a difficulty `<select>`, or even `type={'range'}` (the same slider in JSX's brace
 * spelling) made it a "data app". And for a literal range-only form, the reason sentence told the user to
 * name their fields "so this check can prove the app really saves what is typed" while the gate, reading
 * `appHasNoDataEntry`, said there was nothing to save — two readers, two answers.
 */
import { describe, it, expect } from 'vitest';
import {
  appHasNoDataEntry, dataEntryEvidence, noJourneyReason, deriveJourneys, gameNoJourneyReason, NO_DATA_ENTRY_REASON,
} from '../src/server/AgentV3/journeyDerivation';

/** A hand-written three.js racing game laid out the way 46e2d74b laid its own out (src/lib/game, a GameShell). */
function racingGame(shell: string): Record<string, string> {
  return {
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
    'src/App.tsx': "import GameShell from './components/GameShell';\nexport default function App() { return <GameShell />; }",
    'src/lib/game/scene.ts': "import * as THREE from 'three';\nexport function run(canvas: HTMLCanvasElement) {\n  const renderer = new THREE.WebGLRenderer({ canvas });\n  const loop = () => { renderer.render(scene, camera); requestAnimationFrame(loop); };\n  requestAnimationFrame(loop);\n}",
    'src/components/GameShell.tsx': shell,
  };
}

const SETTINGS_SHELL = `import { useState } from 'react';
import { run } from '../lib/game/scene';
export default function GameShell() {
  const [sound, setSound] = useState(true);
  const [laps, setLaps] = useState(3);
  const [level, setLevel] = useState('easy');
  return (
    <div className="shell">
      <canvas ref={(c) => c && run(c)} />
      <label><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound</label>
      <input type={'range'} min={1} max={5} value={laps} onChange={(e) => setLaps(+e.target.value)} />
      <select value={level} onChange={(e) => setLevel(e.target.value)}><option>easy</option><option>hard</option></select>
      <button onClick={() => setSound(!sound)}>Start Race</button>
    </div>
  );
}`;

describe('a game whose only inputs are its settings has nothing to save', () => {
  it('the 46e2d74b shape — a sound checkbox, a brace-spelled range, a difficulty select — is not a data app', () => {
    const files = racingGame(SETTINGS_SHELL);
    expect(dataEntryEvidence(files)).toBeNull();
    expect(appHasNoDataEntry(files)).toBe(true);
  });

  it('and the derivation SAYS it is a game, judged by being played — never a form remedy', () => {
    const why = noJourneyReason(racingGame(SETTINGS_SHELL));
    expect(why).toMatch(/^this is a game — /);
    expect(why).toMatch(/proven by being PLAYED/);
    expect(why).not.toMatch(/saves what is typed|give each field|no name, id/i);
  });

  it('a game that keeps a best score says where, in the same sentence', () => {
    const files = racingGame(SETTINGS_SHELL.replace('const [sound', "localStorage.setItem('bestLap', '1');\n  const [sound"));
    expect(noJourneyReason(files)).toMatch(/keeps its progress in browser storage in src\/components\/GameShell\.tsx/);
    expect(gameNoJourneyReason(null)).not.toMatch(/keeps its progress/);
  });

  it('a component-library setting (<Switch>, <Slider>) in a game is a setting too', () => {
    const shell = SETTINGS_SHELL.replace('<select value={level}', '<Switch checked={sound} onChange={setSound} /><Slider value={laps} onChange={setLaps} /><select value={level}');
    expect(appHasNoDataEntry(racingGame(shell))).toBe(true);
  });
});

describe('precision — real data entry still counts, in a game and out of one', () => {
  it('a game that asks for the player\'s name for its leaderboard IS a data app, and its journey is derived', () => {
    const shell = SETTINGS_SHELL.replace('<button onClick',
      '<form onSubmit={(e) => { e.preventDefault(); localStorage.setItem("scores", name); }}><input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /><button type="submit">Save score</button></form>\n      <button onClick')
      .replace("const [level", "const [name, setName] = useState('');\n  const [level");
    const files = racingGame(shell);
    expect(appHasNoDataEntry(files)).toBe(false);
    expect(dataEntryEvidence(files)?.path).toBe('src/components/GameShell.tsx');
    expect(deriveJourneys({ files, routes: ['/'] }).length).toBeGreaterThan(0);
  });

  it('outside a game, a checkbox, a select and a <Switch> still count exactly as before', () => {
    const todo = {
      'src/main.tsx': "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App />);",
      'src/App.tsx': "export default function App() { return <ul><li><input type=\"checkbox\" checked={done} onChange={toggle} /> Buy milk</li></ul>; }",
    };
    expect(appHasNoDataEntry(todo)).toBe(false);
    expect(appHasNoDataEntry({ ...todo, 'src/App.tsx': 'export default function App() { return <select onChange={pick}><option>a</option></select>; }' })).toBe(false);
    expect(appHasNoDataEntry({ ...todo, 'src/App.tsx': 'export default function App() { return <Switch checked={on} onChange={setOn} />; }' })).toBe(false);
  });

  it('a computed type={kind} is never read as a literal, in a game or not', () => {
    const shell = SETTINGS_SHELL.replace('<input type={\'range\'}', '<input type={kind}');
    expect(appHasNoDataEntry(racingGame(shell))).toBe(false);
  });
});

describe('THE SIBLINGS — the literal spelling, and the sentence that contradicted the gate', () => {
  const slider = (type: string) => ({
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App />);",
    'src/App.tsx': `export default function App() { return <label>Volume <input ${type} min={0} max={10} value={v} onChange={(e) => setV(+e.target.value)} /></label>; }`,
  });

  it('type={\'range\'}, type={"range"} and type={`range`} are the same element as type="range"', () => {
    for (const t of ['type="range"', "type={'range'}", 'type={"range"}', 'type={`range`}']) {
      expect(appHasNoDataEntry(slider(t)), t).toBe(true);
    }
    expect(appHasNoDataEntry({ 'src/App.tsx': "export default () => <input type={'search'} placeholder=\"Find\" onChange={f} />" })).toBe(true);
  });

  it('a range-only app is told it has nothing to save — never to name its fields so saving can be proven', () => {
    // The report map's own fixture: a canvas and one uncontrolled volume slider, no game loop.
    const why = noJourneyReason({
      'src/main.tsx': "import App from './App';\ncreateRoot(document.getElementById('root')!).render(<App/>);",
      'src/App.tsx': "import GameShell from './components/GameShell';\nexport default function App(){ return <GameShell/>; }",
      'src/components/GameShell.tsx': 'export default function GameShell(){ return <div><canvas/><input type="range" min={0} max={1} /></div>; }',
    });
    expect(why).toBe(NO_DATA_ENTRY_REASON);
    expect(why).not.toMatch(/saves what is typed/);
  });
});
