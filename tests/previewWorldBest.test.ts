import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * WORLD-BEST PREVIEW (admin 2026-08-06: "duniya ke sabhi app builder ke preview analyse karo, acche
 * points hamare me joro"). The two features this slice adopts:
 *   1. CONSOLE DRAWER — the running app's console mirrored into the panel (Replit ships devtools;
 *      Bolt leaves users at F12) with one-tap "Fix with AI" on every error.
 *   2. ASK-AI-ABOUT-ELEMENT — Lovable's signature move: pick an element, tell the AI what to change;
 *      the selection's data-nbai-src stamp already carries file:line:column, so the edit targets the
 *      exact JSX, never a guess.
 */

const APP = {
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
  'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
  'src/App.tsx': "export default function App(){ return <div>Hello</div>; }",
};

describe('console mirror in the generated preview page', () => {
  it('mirrors every console level + window errors + unhandled rejections up to the host', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(APP));
    expect(html).toContain('__nbaiPreviewConsole');
    for (const lvl of ["'log'", "'info'", "'warn'", "'error'"]) expect(html).toContain(lvl);
    expect(html).toContain("addEventListener('error'");
    expect(html).toContain("addEventListener('unhandledrejection'");
    // The mirror wraps but never replaces the app's own console (orig.apply keeps it working).
    expect(html).toContain('orig[level].apply(console, arguments)');
    // Bounded per message — a huge object dump cannot flood the postMessage channel.
    expect(html).toContain('.slice(0, 600)');
  });
});

const surface = readFileSync(join(__dirname, '..', 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

describe('console drawer in the panel', () => {
  it('listens for the mirror, ring-buffers entries, and shows an error-count badge', () => {
    expect(surface).toContain('__nbaiPreviewConsole');
    expect(surface).toContain('.slice(-200)');                 // ring buffer — never unbounded
    expect(surface).toContain('consoleErrorCount');
    expect(surface).toContain('Console is empty');
  });

  it('every error row hands off to the SAME Fix-with-AI flow the preview already uses', () => {
    const drawer = surface.slice(surface.indexOf('consoleOpen && ('));
    expect(drawer).toContain('onFixError(c.text)');
    expect(drawer).toContain('Fix with AI');
  });
});

describe('ask-AI-about-element', () => {
  it('the selection toolbar offers Ask AI carrying the EXACT source location', () => {
    expect(surface).toContain('onAskAiAboutElement');
    expect(surface).toContain('selection.file');
    const btn = surface.indexOf('onAskAiAboutElement(`');
    expect(btn).toBeGreaterThan(-1);
    const call = surface.slice(btn, btn + 200);
    expect(call).toContain('selection.line');
    expect(call).toContain('selection.column');
  });

  it('the panel prefills the chat with the element reference and brings the chat into view', () => {
    const at = panel.indexOf('onAskAiAboutElement={(context)');
    expect(at).toBeGreaterThan(-1);
    const seg = panel.slice(at, at + 700);
    expect(seg).toContain('setPrompt(');
    expect(seg).toContain('Change this exact element');
    expect(seg).toContain('setShowWorkspace(false)');
  });
});
