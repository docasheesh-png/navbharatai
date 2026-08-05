import { describe, it, expect } from 'vitest';
import { buildReactPreview, SHADCN_TW_CONFIG, SHADCN_CSS_VARS } from './ReactPreview';
import { VirtualFileSystem } from '../project/ProjectModel';

// mitrify2 import autopsy (2026-07-17): the in-browser preview loaded the Tailwind Play CDN but never
// declared the shadcn design tokens, so a stylesheet with `@apply border-border` died with
// "The `border-border` class does not exist". The Play CDN cannot read the project tailwind.config.js,
// so the tokens MUST be injected inline. This must never recur — for border or any shadcn colour token.
const SHADCN_APP = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
  'tailwind.config.js': "module.exports = { content: ['./src/**/*.{js,jsx,ts,tsx}'], theme: { extend: {} } };",
  'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground; } }',
  'src/main.jsx': "import './index.css';\nimport App from './App';\nexport default function boot(){ return App; }",
  'src/App.jsx': "export default function App(){ return <div className='border-border bg-background text-foreground'>Hi</div>; }",
};

describe('ReactPreview — shadcn design tokens are always registered for the Tailwind Play CDN', () => {
  const html = buildReactPreview(VirtualFileSystem.fromRecord(SHADCN_APP));

  it('injects the inline tailwind.config so border/background/foreground utilities EXIST', () => {
    expect(html).toContain('cdn.tailwindcss.com');
    expect(html).toContain(SHADCN_TW_CONFIG);
    // the exact tokens whose absence killed the mitrify2 preview
    expect(SHADCN_TW_CONFIG).toContain("border:'hsl(var(--border))'");
    expect(SHADCN_TW_CONFIG).toContain("background:'hsl(var(--background))'");
    expect(SHADCN_TW_CONFIG).toContain("foreground:'hsl(var(--foreground))'");
  });

  it('supplies default shadcn CSS variables so the colours render even without a :root block', () => {
    expect(html).toContain(SHADCN_CSS_VARS);
    expect(SHADCN_CSS_VARS).toContain('--border:');
    expect(SHADCN_CSS_VARS).toContain('--background:');
    // the defaults come BEFORE the project CSS, so the app's own :root (if any) still wins
    expect(html.indexOf(SHADCN_CSS_VARS)).toBeLessThan(html.indexOf('@apply border-border'));
  });

  it('the config script is emitted after the Tailwind CDN so tailwind.config is set before compile', () => {
    expect(html.indexOf('cdn.tailwindcss.com')).toBeLessThan(html.indexOf('tailwind.config='));
  });
});

describe('ReactPreview — non-Tailwind apps are byte-for-byte unaffected', () => {
  it('a plain-CSS React app gets NO tailwind CDN, config, or shadcn vars injected', () => {
    const plain = {
      'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'src/index.css': 'body { margin: 0; font-family: system-ui; }',
      'src/main.jsx': "import './index.css';\nimport App from './App';\nexport default function boot(){ return App; }",
      'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
    };
    const html = buildReactPreview(VirtualFileSystem.fromRecord(plain));
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toContain('tailwind.config=');
    expect(html).not.toContain(SHADCN_CSS_VARS);
  });
});

// Preview boot-watchdog (autopsy 2026-07-31, ROOT-CAUSED 2026-08-05): a large build loading deps from the
// esm.sh CDN on a slow network false-failed against a FLAT elapsed-time watchdog even though nothing had
// actually gone wrong — the app was still downloading. Raising the number (25s → 45s) was the treadmill fix:
// the next-bigger app on the next-slower network fails again. The watchdog now fires on a STALL (no module
// resolved for STALL_MS) instead of on elapsed time, so a preview that is genuinely making progress is never
// killed, however long it takes. This block locks that shape — a return to any flat deadline re-breaks it.
// (The full watchdog invariants live in ReactPreview.watchdog.test.ts, which parses the real script.)
describe('ReactPreview — in-browser boot watchdog measures progress, not elapsed time', () => {
  const html = buildReactPreview(VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
    'src/main.jsx': "import App from './App';\nexport default function boot(){ return App; }",
    'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
  }));

  it('never declares failure on a fixed elapsed-time deadline', () => {
    expect(html).not.toContain('did not start within 25 seconds');
    expect(html).not.toContain('did not start within 45 seconds');
    expect(html).not.toContain('}, 25000);');
    expect(html).not.toContain('}, 45000);');
  });

  it('tracks last-progress and stalls instead', () => {
    expect(html).toContain('nbaiLastProgress');
    expect(html).toContain('STALL_MS');
    expect(html).toContain('HARD_CEILING_MS');
  });
});
