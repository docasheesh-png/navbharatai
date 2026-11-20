// 🔴 A MISSING PLAIN STYLESHEET IMPORT IS CREATED DETERMINISTICALLY (failedbr #2155, 2026-11-20).
//
// `src/main.tsx` imported `./index.css`, which did not exist; the model's creation pass did not produce it and the build
// ended RED ("1 local module(s) are STILL missing … src/index.css (imported by src/main.tsx)"). The deterministic
// CSS-module generator knew only `*.module.css`. Reversion: drop the plain-stylesheet branch and the first test fails.

import { describe, it, expect } from 'vitest';
import { generateMissingCssModules } from '../src/server/AgentV3/CssModuleGenerator';

const MAIN = "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport './index.css';\nimport { App } from './App';\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n";

describe("#2155: the entry's missing index.css is created", () => {
  it('one valid, empty stylesheet at the imported path, naming its importer', () => {
    const out = generateMissingCssModules({ 'src/main.tsx': MAIN });
    expect(out.map((o) => o.path)).toEqual(['src/index.css']);
    expect(out[0].content).toMatch(/src\/main\.tsx imports this stylesheet/);
    expect(out[0].content).not.toMatch(/[{}]/);
  });
});

describe('the boundaries', () => {
  it('an existing stylesheet (written or only listed) is never touched', () => {
    expect(generateMissingCssModules({ 'src/main.tsx': MAIN, 'src/index.css': 'body{}' })).toEqual([]);
    expect(generateMissingCssModules({ 'src/main.tsx': MAIN }, ['src/index.css'])).toEqual([]);
  });
  it('a package stylesheet is not ours to create', () => {
    expect(generateMissingCssModules({ 'src/main.tsx': "import 'bootstrap/dist/css/bootstrap.min.css';\n" })).toEqual([]);
  });
  it('a CSS module still gets its class names', () => {
    const out = generateMissingCssModules({ 'src/Card.tsx': "import styles from './Card.module.css';\nexport const C = () => <div className={styles.card} />;\n" });
    expect(out[0].path).toBe('src/Card.module.css');
    expect(out[0].content).toMatch(/\.card/);
  });
});
