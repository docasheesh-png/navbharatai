// AUTOPSY 1389f0d5 (2026-09-30): "src/App.tsx uses .calc-display, .calc-expression … — no stylesheet in this
// project defines them, so those elements render UNSTYLED. Add the rules to src/index.css now."
//
// Every one of those classes was defined in src/calculator.css, which App.tsx imports on its third line. The
// note looked for stylesheets under a fixed list of names, so it never saw that file, and it said the same
// thing after every write of App.tsx. The model believed it and spent five edits copying rules into
// src/index.css. Meanwhile the one real problem — src/pdf-genesis.css, written that turn and imported by
// nothing — was reported as "no stylesheet defines them", and only an end-of-build heal pass wired it in.
// Locked here:
//   1. a class defined in a stylesheet the screen imports is not reported;
//   2. so is one defined in any other project stylesheet (a parent component's sheet);
//   3. a class defined only in a sheet nothing imports gets the one-line remedy — import it;
//   4. a class defined nowhere is still reported, exactly as before.
import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { cssImportsOf, relativeSpecifier, unimportedSheetNote } from '../src/server/AgentV3/CssConsistency';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: `c${++n}`, name, input });

class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const MAIN = `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport './index.css';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`;
const INDEX_CSS = `:root { --accent: #4f46e5; }\n.btn { padding: 8px; }\n.card { border-radius: 12px; }\n`;
const CALC_CSS = `.calc-page { display: flex; }\n.calc-display { font-size: 32px; }\n.calc-expression { opacity: .7; }\n.calc-key { padding: 12px; }\n`;
const APP = `import { useState } from 'react';\nimport './calculator.css';\nimport PdfGenesis from './PdfGenesis';\n\nexport default function App() {\n  const [m] = useState('calc');\n  return (\n    <div className="calc-page">\n      <div className="calc-display"><span className="calc-expression">1+1</span></div>\n      <button className="calc-key">=</button>\n      {m === 'pdf' && <PdfGenesis />}\n    </div>\n  );\n}\n`;

function setup() {
  const act = new MemActuator();
  act.files.set('src/main.tsx', MAIN);
  act.files.set('src/index.css', INDEX_CSS);
  act.files.set('src/calculator.css', CALC_CSS);
  act.files.set('src/App.tsx', APP);
  act.files.set('package.json', JSON.stringify({ name: 'calc', dependencies: { react: '^18.2.0' } }));
  const d = new ToolDispatcher(act, 'ws-1');
  return { act, d };
}

describe('1 · a stylesheet the screen imports defines its classes', () => {
  it('🔴 the report: editing App.tsx, whose classes live in the calculator.css it imports, says nothing about them', async () => {
    const { d } = setup();
    const r = await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: '1+1', new_string: '2+2' }));
    expect(r.is_error).toBe(false);
    expect(r.content).not.toMatch(/calc-display|calc-expression|calc-key|calc-page/);
    expect(r.content).not.toMatch(/no stylesheet in this project defines/);
  });
  it('a child component using its parent\'s sheet is not reported either', async () => {
    const { d } = setup();
    const r = await d.dispatch(call('write_file', { path: 'src/Keypad.tsx', content: `export default function Keypad() {\n  return <button className="calc-key">7</button>;\n}\n` }));
    expect(r.content).not.toMatch(/calc-key/);
  });
});

describe('2 · a sheet nothing imports gets the import, not new rules', () => {
  it('🔴 the report: PdfGenesis.tsx + pdf-genesis.css in one batch, never imported', async () => {
    const { d } = setup();
    const r = await d.dispatch(call('write_files_batch', { files: [
      { path: 'src/PdfGenesis.tsx', content: `export default function PdfGenesis() {\n  return <section className="pdf-genesis-document"><h2 className="pdf-doc-title">Genesis 4</h2></section>;\n}\n` },
      { path: 'src/pdf-genesis.css', content: `.pdf-genesis-document { padding: 24px; }\n.pdf-doc-title { font-size: 28px; }\n` },
    ] }));
    expect(r.content).toMatch(/src\/pdf-genesis\.css defines them, but nothing imports src\/pdf-genesis\.css/);
    expect(r.content).toContain("Add `import './pdf-genesis.css';` to src/PdfGenesis.tsx");
    expect(r.content).not.toMatch(/PdfGenesis\.tsx uses [^\n]* — no stylesheet in this project defines/);
  });
  it('once the screen imports it, the note goes quiet', async () => {
    const { d } = setup();
    await d.dispatch(call('write_file', { path: 'src/pdf-genesis.css', content: `.pdf-doc-title { font-size: 28px; }\n` }));
    const r = await d.dispatch(call('write_file', { path: 'src/PdfGenesis.tsx', content: `import './pdf-genesis.css';\nexport default function PdfGenesis() {\n  return <h2 className="pdf-doc-title">Genesis 4</h2>;\n}\n` }));
    expect(r.content).not.toMatch(/pdf-doc-title/);
  });
});

describe('3 · a class defined nowhere is still reported', () => {
  it('🔒 precision did not cost recall', async () => {
    const { d } = setup();
    const r = await d.dispatch(call('write_file', { path: 'src/Report.tsx', content: `export default function Report() {\n  return <div className="report-panel"><p className="report-total">1</p></div>;\n}\n` }));
    expect(r.content).toMatch(/src\/Report\.tsx uses \.report-panel, \.report-total — no stylesheet in this project defines them/);
  });
});

describe('4 · the pure helpers', () => {
  it('reads every relative stylesheet import form, and resolves it', () => {
    const src = `import './a.css';\nimport styles from '../b.module.css';\nconst x = require('./c.scss');\nimport 'bootstrap/dist/css/bootstrap.css';\n`;
    expect(cssImportsOf('src/pages/Home.tsx', src).sort()).toEqual(['src/b.module.css', 'src/pages/a.css', 'src/pages/c.scss']);
    expect(cssImportsOf('src/index.css', `@import './theme.css';`)).toEqual(['src/theme.css']);
  });
  it('writes the specifier from the importer to the sheet', () => {
    expect(relativeSpecifier('src/PdfGenesis.tsx', 'src/pdf-genesis.css')).toBe('./pdf-genesis.css');
    expect(relativeSpecifier('src/pages/Home.tsx', 'src/styles/home.css')).toBe('../styles/home.css');
    expect(unimportedSheetNote('src/A.tsx', [])).toBe('');
  });
});
