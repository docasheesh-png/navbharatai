import { describe, it, expect } from 'vitest';
import { previewFidelityCaveats, previewFidelityNotice } from '../src/server/AgentV3/previewFidelity';

const ids = (files: Record<string, string>) => previewFidelityCaveats(files).map((c) => c.id);

describe('previewFidelityCaveats — say what is approximate, and nothing else', () => {
  it('says NOTHING about an ordinary app the preview renders faithfully', () => {
    expect(previewFidelityCaveats({
      'index.html': '<html><body><div id="root"></div></body></html>',
      'src/App.tsx': 'export default function App(){ return <div className="p-4">hi</div>; }',
      'src/index.css': 'body{margin:0}',
      'package.json': '{"dependencies":{"react":"^18.3.1"}}',
    })).toEqual([]);
  });

  it('flags CSS Modules, whose class names come out blank', () => {
    expect(ids({ 'src/Card.module.css': '.card{color:red}', 'src/Card.tsx': "import s from './Card.module.css';" }))
      .toContain('css-modules');
  });

  it('flags Sass/Less, which is not compiled in the page at all', () => {
    expect(ids({ 'src/main.scss': '$c: red; body{color:$c}' })).toContain('css-preprocessor');
    expect(ids({ 'src/main.less': '@c: red;' })).toContain('css-preprocessor');
  });

  it('flags background workers, which never start here', () => {
    expect(ids({ 'src/App.tsx': "const w = new Worker(new URL('./w.ts', import.meta.url));" })).toContain('web-worker');
  });

  it('flags Vite bulk imports, which throw on load here', () => {
    expect(ids({ 'src/pages.ts': "const mods = import.meta.glob('./pages/*.tsx');" })).toContain('vite-glob');
  });

  it('flags a CUSTOMISED Tailwind theme — the silent one, where the app renders in the wrong colours', () => {
    expect(ids({ 'tailwind.config.js': "module.exports={theme:{extend:{colors:{brand:'#123456'}}}}" }))
      .toContain('tailwind-config');
  });

  it('does NOT flag a Tailwind config that customises nothing', () => {
    // A stock config changes nothing about how the page renders, so a caveat here would be a false
    // alarm — and a false caveat sends the user to the paid live server for no reason.
    expect(ids({ 'tailwind.config.js': "module.exports={content:['./src/**/*.tsx'],theme:{extend:{}},plugins:[]}" }))
      .not.toContain('tailwind-config');
  });

  it('flags public/ assets, which have no server to be served from', () => {
    expect(ids({ 'public/logo.png': 'data', 'src/App.tsx': 'export default () => <img src="/logo.png" />;' }))
      .toContain('public-assets');
    // index.html inside public/ is the app's own entry document, not an asset — flagging it would be
    // a caveat on every single Create-React-App project, all of them wrong.
    expect(ids({ 'public/index.html': '<html></html>' })).not.toContain('public-assets');
  });

  it('never scans node_modules', () => {
    expect(previewFidelityCaveats({ 'node_modules/x/y.scss': 'a{}', 'node_modules/z/a.module.css': '.a{}' })).toEqual([]);
  });
});

describe('previewFidelityNotice — one sentence, never a wall', () => {
  it('is empty when the preview is faithful', () => {
    expect(previewFidelityNotice([])).toBe('');
  });

  it('gives the single caveat verbatim', () => {
    const c = previewFidelityCaveats({ 'src/a.scss': 'a{}' });
    expect(previewFidelityNotice(c)).toBe(c[0].text);
  });

  it('summarises several rather than listing them — a wall of caveats reads as "this is broken"', () => {
    const c = previewFidelityCaveats({ 'src/a.scss': 'a{}', 'src/b.module.css': '.b{}', 'public/logo.png': 'x' });
    const line = previewFidelityNotice(c);
    expect(line).toContain('and 2 other differences');
    expect(line.split('.').length).toBeLessThan(5);
  });

  it('gets the singular right for exactly two', () => {
    const c = previewFidelityCaveats({ 'src/a.scss': 'a{}', 'public/logo.png': 'x' });
    expect(previewFidelityNotice(c)).toContain('and 1 other difference');
  });
});
