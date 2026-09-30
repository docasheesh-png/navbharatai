// Autopsy 33812996 (2026-09-30). `lazy(() => import("./components/QRScanner").then(mod => ({ default:
// mod.QRScanner })))` over `export default QRScanner` — TS2339, left standing through 560 s of fast-lane
// repair. The kind reconciler only read import declarations; the dynamic form was invisible to it.
import { describe, it, expect } from 'vitest';
import { reconcileImportExports } from '../src/server/AgentV3/ImportExportReconcile';
import { webPlatformRule } from '../src/server/AgentV3/SimpleBuilder';

const APP = `import React, { Suspense, lazy } from "react";
const QRScanner = lazy(() => import("./components/QRScanner").then(mod => ({ default: mod.QRScanner })));
const Translation = lazy(() => import("./components/Translation").then(mod => ({ default: mod.Translation })));
export default function App() { return <Suspense fallback={null}><QRScanner /><Translation /></Suspense>; }
`;

describe('the report\'s own lazy imports', () => {
  it('🔴 a member that is only the default export becomes the plain dynamic import', async () => {
    const r = await reconcileImportExports({
      'src/App.tsx': APP,
      'src/components/QRScanner.tsx': 'const QRScanner = () => null;\nexport default QRScanner;\n',
      'src/components/Translation.tsx': 'export const Translation = () => null;\n',
    });
    expect(r.files['src/App.tsx']).toContain('lazy(() => import("./components/QRScanner"))');
    // Translation IS a named export — its .then() form is correct and untouched.
    expect(r.files['src/App.tsx']).toContain('.then(mod => ({ default: mod.Translation }))');
    expect(r.fixes.map((f) => f.name)).toEqual(['QRScanner']);
  });
  it('a default whose own name differs is not guessed at', async () => {
    const r = await reconcileImportExports({
      'src/App.tsx': APP,
      'src/components/QRScanner.tsx': 'const Scanner = () => null;\nexport default Scanner;\n',
      'src/components/Translation.tsx': 'export const Translation = () => null;\n',
    });
    expect(r.fixes).toHaveLength(0);
  });
});

describe('a web app is told it is one', () => {
  it('vite-react gets the rule; React Native and Expo do not', () => {
    expect(webPlatformRule('vite-react').join('')).toMatch(/never import react-native/);
    expect(webPlatformRule('react-native')).toEqual([]);
    expect(webPlatformRule('expo')).toEqual([]);
  });
});
