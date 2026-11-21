// Q-2316 (failedbr #1823, #1822, 2026-11-20): `src/nb-autostyle.css` ended "imported by nothing". A rewrite of the
// mount dropped the floor's import, and the floor re-imported only when its own sheet changed.
import { describe, expect, it } from 'vitest';
import { AUTO_STYLE_PATH, keepAutoStyleImport } from '../src/server/AgentV3/autoStyleFloor';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const WIRED = "import './nb-autostyle.css';\nimport './index.css';\nimport App from './App';\n";
const DROPPED = "import './index.css';\nimport App from './App';\nimport { Providers } from './Providers';\n";

describe('the style floor stays imported (Q-2316)', () => {
  it('pure: a mount rewrite that drops the floor import gets it back, first', () => {
    const kept = keepAutoStyleImport('src/main.tsx', WIRED, DROPPED)!;
    expect(kept.startsWith("import './nb-autostyle.css';")).toBe(true);
    expect(kept).toContain("import { Providers } from './Providers';");
  });

  it('pure: a mount that never had it, a write that keeps it, and any other file are left alone', () => {
    expect(keepAutoStyleImport('src/main.tsx', DROPPED, DROPPED)).toBeNull();
    expect(keepAutoStyleImport('src/main.tsx', WIRED, WIRED)).toBeNull();
    expect(keepAutoStyleImport('src/App.tsx', WIRED, DROPPED)).toBeNull();
  });

  it('🔴 through write_file: the builder rewrites main.tsx without the floor import, and it is kept', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/main.tsx', WIRED);
    act.files.set(AUTO_STYLE_PATH, '.question-card { padding: 16px; }\n');
    await d.dispatch(toolCall('write_file', { path: 'src/main.tsx', content: DROPPED }, 'w'), 'frontend');
    expect(act.files.get('src/main.tsx')!.startsWith("import './nb-autostyle.css';")).toBe(true);
  });

  it('🔴 the #1822 shape: a turn that starts with an orphaned floor sheet re-imports it at the first screen write', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/main.tsx', DROPPED);
    act.files.set('src/index.css', 'body { margin: 0 }\n.app-shell { padding: 4px }\n');
    act.files.set(AUTO_STYLE_PATH, '/* navbharatai:auto-style-floor — every class has a real rule now. */\n');
    await d.dispatch(toolCall('write_file', {
      path: 'src/pages/Home.tsx',
      content: 'export default function Home() { return <div className="app-shell">Home</div>; }\n',
    }, 'h'), 'frontend');
    expect(act.files.get('src/main.tsx')!.startsWith("import './nb-autostyle.css';")).toBe(true);
  });

  it('a project with no floor sheet gets no import', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/main.tsx', DROPPED);
    act.files.set('src/index.css', 'body { margin: 0 }\n.app-shell { padding: 4px }\n');
    await d.dispatch(toolCall('write_file', {
      path: 'src/pages/Home.tsx',
      content: 'export default function Home() { return <div className="app-shell">Home</div>; }\n',
    }, 'h'), 'frontend');
    expect(act.files.get('src/main.tsx')).toBe(DROPPED);
  });
});
