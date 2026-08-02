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

// Preview boot-watchdog timeout (autopsy 2026-07-31): a large SaaS-dashboard build (600 KB+ bundle) loading
// deps from the esm.sh CDN on a slow mobile network hit the OLD 25s in-browser watchdog and false-failed
// with "did not start within 25 seconds", even though the production build succeeded. Bumped to 45s (the
// server-side preview already allows 90s). Lock the more generous ceiling so a tighten can't re-break it.
describe('ReactPreview — in-browser boot watchdog is generous enough for a large app', () => {
  const html = buildReactPreview(VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
    'src/main.jsx': "import App from './App';\nexport default function boot(){ return App; }",
    'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
  }));

  it('waits 45s (not the old 25s) before declaring a boot failure', () => {
    expect(html).toContain('}, 45000);');
    expect(html).toContain('did not start within 45 seconds');
    expect(html).not.toContain('}, 25000);');
    expect(html).not.toContain('did not start within 25 seconds');
  });
});
