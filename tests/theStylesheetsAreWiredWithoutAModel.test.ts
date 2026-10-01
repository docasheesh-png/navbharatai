// Autopsy 33812996 (2026-09-30, "Circle to Search"). The fast lane planned src/styles/global.css,
// components.css and themes.css. At the end: global.css imported by BOTH src/main.tsx and src/App.tsx,
// components.css and themes.css imported by nothing. The deterministic guard wired only a GLOBAL-named
// sheet, so all three findings went to an LLM heal pass — a model call whose answer (add two import lines,
// delete one) has exactly one right form.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  injectGlobalStylesheetImport, dedupeStylesheetImports, isAppWideStylesheet, analyzeProjectIntegrity,
} from '../src/server/AgentV3/ProjectIntegrityChecks';

const REPORT = {
  'src/main.tsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './styles/global.css';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`,
  'src/App.tsx': `import React from 'react';\nimport "./styles/global.css";\nexport default function App() { return <div className="app" />; }\n`,
  'src/styles/global.css': 'body { margin: 0; }',
  'src/styles/components.css': '.card { padding: 16px; }',
  'src/styles/themes.css': ':root { --bg: #fff; }',
};

describe('the report\'s own project', () => {
  it('🔴 every stylesheet defect is fixed deterministically — the integrity report is clean, no heal needed', () => {
    const wired = injectGlobalStylesheetImport(REPORT);
    const deduped = dedupeStylesheetImports(wired.files);
    expect(wired.injected.map((i) => i.stylesheet).sort()).toEqual(['src/styles/components.css', 'src/styles/themes.css']);
    expect(deduped.removed).toEqual([{ stylesheet: './styles/global.css', from: 'src/App.tsx' }]);
    const after = analyzeProjectIntegrity(deduped.files);
    expect(after.orphanStylesheets).toHaveLength(0);
    expect(after.duplicateStylesheets).toHaveLength(0);
    expect(after.ok).toBe(true);
  });
  it('the entry keeps its own import; App loses only the css line', () => {
    const out = dedupeStylesheetImports(REPORT).files;
    expect(out['src/main.tsx']).toBe(REPORT['src/main.tsx']);
    expect(out['src/App.tsx']).toBe(`import React from 'react';\nexport default function App() { return <div className="app" />; }\n`);
  });
});

describe('which sheets are app-wide', () => {
  it.each(['src/index.css', 'src/styles/components.css', 'src/styles/anything.css', 'src/css/site.css', 'src/themes.css', 'src/variables.css'])('%s', (p) => {
    expect(isAppWideStylesheet(p)).toBe(true);
  });
  it.each(['src/components/Sidebar.css', 'src/pages/Checkout.css', 'src/styles/Button.module.css'])('NOT %s', (p) => {
    expect(isAppWideStylesheet(p)).toBe(false);
  });
});

describe('what is left alone', () => {
  it('a duplicate the entry is not part of stays a finding', () => {
    const files = {
      'src/main.tsx': `import App from './App';\n`,
      'src/A.tsx': `import './shared.css';\n`,
      'src/B.tsx': `import './shared.css';\n`,
      'src/shared.css': '.x{}',
    };
    expect(dedupeStylesheetImports(files).removed).toHaveLength(0);
  });
  it('no duplicate → the same object comes back', () => {
    const files = { 'src/main.tsx': `import './index.css';\n`, 'src/index.css': 'body{}' };
    expect(dedupeStylesheetImports(files).files).toBe(files);
  });
});

describe('both lanes call it', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('the route and the fast lane', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('const deduped = dedupeStylesheetImports(integrityFiles);');
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toContain('const deduped = dedupeStylesheetImports(');
  });
});
