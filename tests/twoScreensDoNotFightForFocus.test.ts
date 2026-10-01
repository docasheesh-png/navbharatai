import { describe, it, expect } from 'vitest';
import { analyzeProjectIntegrity, conflictingFocusOwners, findFocusOwners } from '../src/server/AgentV3/ProjectIntegrityChecks';

/**
 * 🔴 THE REPORT (build 4d538ca3, 2026-10-01). A personal-assistant app switches screens with a `view`
 * state: Home, Chat, Memory, Settings. Chat focuses its message box on mount; the new Memory screen
 * focused its fact input on mount. The integrity check said "2 components grab initial focus — only one
 * may own initial focus", and the repair removed Memory's focus: four edits, three type errors on the
 * way (it deleted the `useRef` import before the ref), 35 seconds — to make opening Memory slightly
 * worse. Chat and Memory are never on screen together, so there was nothing to fix.
 */

const MOUNT_FOCUS = (name: string) => `import { useEffect, useRef } from 'react';
export default function ${name}() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <input ref={ref} aria-label="${name}" />;
}
`;

const APP_AND = `import Chat from './components/Chat';
import Memory from './components/Memory';
import Home from './components/Home';
export default function App() {
  const [view, setView] = useState<'home' | 'chat' | 'memory'>('home');
  return (
    <div>
      {view === 'home' && <Home onOpen={(v) => setView(v)} />}
      {view === 'chat' && activeChat && (
        <Chat chat={activeChat} onBack={() => setView('home')} />
      )}
      {view === 'memory' && <Memory onBack={() => setView('home')} />}
    </div>
  );
}
`;

const files = (app: string) => ({
  'src/App.tsx': app,
  'src/components/Chat.tsx': MOUNT_FOCUS('Chat'),
  'src/components/Memory.tsx': MOUNT_FOCUS('Memory'),
  'src/components/Home.tsx': 'export default function Home() { return <main />; }',
});

describe('two focus owners conflict only when they can be on screen together', () => {
  it('🔴 the report shape: screens picked by view === … are exclusive — no conflict, no repair', () => {
    const f = files(APP_AND);
    expect(findFocusOwners(f)).toHaveLength(2);
    const r = analyzeProjectIntegrity(f);
    expect(r.focusOwners).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a switch on the view is the same thing', () => {
    const app = `export default function App() {
  const render = () => {
    switch (view) {
      case 'chat': return <Chat />;
      case 'memory': return <Memory />;
      default: return <Home />;
    }
  };
  return <div>{render()}</div>;
}`;
    expect(analyzeProjectIntegrity(files(app)).focusOwners).toEqual([]);
  });

  it('a ternary chain is the same thing', () => {
    const app = `export default function App() {
  return <div>{view === 'chat' ? <Chat onBack={() => go('home')} /> : view === 'memory' ? <Memory /> : <Home />}</div>;
}`;
    expect(analyzeProjectIntegrity(files(app)).focusOwners).toEqual([]);
  });

  it('🔒 the original defect is still caught: two owners mounted together (the Notes editor + search bar)', () => {
    const app = `export default function App() {
  return <div><Chat /><Memory /></div>;
}`;
    const r = analyzeProjectIntegrity(files(app));
    expect(r.focusOwners.map((o) => o.file).sort()).toEqual(['src/components/Chat.tsx', 'src/components/Memory.tsx']);
    expect(r.ok).toBe(false);
  });

  it('🔒 one guarded and one always mounted is a conflict', () => {
    const app = `export default function App() { return <div><Chat />{view === 'memory' && <Memory />}</div>; }`;
    expect(analyzeProjectIntegrity(files(app)).focusOwners).toHaveLength(2);
  });

  it('🔒 the same screen value for both is a conflict — they mount together', () => {
    const app = `export default function App() { return <div>{view === 'chat' && <Chat />}{view === 'chat' && <Memory />}</div>; }`;
    expect(analyzeProjectIntegrity(files(app)).focusOwners).toHaveLength(2);
  });

  it('🔒 guards on DIFFERENT state values prove nothing — still a conflict', () => {
    const app = `export default function App() { return <div>{tab === 'chat' && <Chat />}{panel === 'memory' && <Memory />}</div>; }`;
    expect(analyzeProjectIntegrity(files(app)).focusOwners).toHaveLength(2);
  });

  it('🔒 a component nobody renders is unknown, and unknown stays a conflict', () => {
    const f = files('export default function App() { return <div />; }');
    expect(analyzeProjectIntegrity(f).focusOwners).toHaveLength(2);
  });

  it('three owners: two exclusive screens and one always-mounted bar — all three conflict with the bar', () => {
    const f = {
      ...files(`export default function App() { return <div><SearchBar />{view === 'chat' && <Chat />}{view === 'memory' && <Memory />}</div>; }`),
      'src/components/SearchBar.tsx': MOUNT_FOCUS('SearchBar'),
    };
    expect(conflictingFocusOwners(findFocusOwners(f), f)).toHaveLength(3);
  });

  it('a single owner is never a conflict', () => {
    const f = { 'src/components/Chat.tsx': MOUNT_FOCUS('Chat') };
    expect(analyzeProjectIntegrity(f).focusOwners).toHaveLength(1);
    expect(analyzeProjectIntegrity(f).ok).toBe(true);
  });
});
