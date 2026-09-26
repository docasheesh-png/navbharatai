import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isNonRuntimeFile, NON_RUNTIME_FILE_SOURCE } from '../src/lib/previewNonRuntimeFiles';
import { buildSourceAppPreview } from '../src/lib/previewUtils';

/**
 * Admin report, workspace …344af61b (build f2ff962f): our own post-build passes added
 * src/App.test.tsx and e2e/smoke.spec.ts, and the in-browser preview then pre-loaded vitest,
 * @testing-library/react and @playwright/test into the user's browser — test tools that never run
 * in the app, one of which brings its own copy of React. The preview died with
 * "Cannot read properties of null (reading 'useState')".
 */
describe('the preview loads the app, not its tests', () => {
  it('🔴 the exact files from the report are never runtime', () => {
    for (const p of ['src/App.test.tsx', 'e2e/smoke.spec.ts', 'playwright.config.ts', 'vite.config.ts']) {
      expect(isNonRuntimeFile(p), p).toBe(true);
    }
  });

  it('test and tool files in their other usual places', () => {
    for (const p of [
      'src/components/__tests__/Button.tsx', 'tests/app.test.ts', 'src/utils.spec.js',
      'cypress/e2e/login.cy.ts', 'src/setupTests.ts', 'vitest.config.mts', 'tailwind.config.js',
      'src/Button.stories.tsx',
    ]) expect(isNonRuntimeFile(p), p).toBe(true);
  });

  it('🔒 every real app file still counts — a name that only LOOKS like a test is not one', () => {
    for (const p of [
      'src/App.tsx', 'src/main.tsx', 'src/pages/TestResults.tsx', 'src/components/Contest.tsx',
      'src/latest.ts', 'src/config.ts', 'src/specials/Offer.tsx', 'src/hooks/useTests.ts',
    ]) expect(isNonRuntimeFile(p), p).toBe(false);
  });

  it('both preview builders read the SAME rule (no second copy to drift)', () => {
    const client = readFileSync(resolve(__dirname, '../src/lib/previewUtils.ts'), 'utf8');
    const server = readFileSync(resolve(__dirname, '../src/server/runtime/ReactPreview.ts'), 'utf8');
    for (const src of [client, server]) {
      expect(src).toContain('NON_RUNTIME_FILE_SOURCE');
      expect(src).toMatch(/if\s*\(\s*NON_RUNTIME\.test\(p\)\s*\)\s*return/);
    }
  });

  it('the client document hands the rule to the browser bootstrap', () => {
    const html = buildSourceAppPreview({
      'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'package.json': JSON.stringify({ dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }, devDependencies: { '@playwright/test': '^1' } }),
      'src/main.tsx': "import { createRoot } from 'react-dom/client'; import App from './App'; createRoot(document.getElementById('root')!).render(<App />);",
      'src/App.tsx': "import { useState } from 'react'; export default function App(){ const [n] = useState(0); return <p>{n}</p>; }",
      'src/App.test.tsx': "import { render } from '@testing-library/react'; import { it } from 'vitest';",
    } as never);
    expect(html).toContain('window.__NON_RUNTIME=');
    // The source survives being embedded as JSON inside the document.
    expect(html).toContain(JSON.stringify(NON_RUNTIME_FILE_SOURCE).replace(/<\//g, '<\\/'));
  });
});
