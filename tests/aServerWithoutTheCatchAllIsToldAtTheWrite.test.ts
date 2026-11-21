// failedbr #1803 / #1801 (2026-11-20): both MP3-converter builds wrote a `server.ts` that served the built client with no
// catch-all, so a reload of /result answered "Cannot GET". The check ran only at the end, after both were stopped.
// It is now said when the server file is written.
import { describe, expect, it } from 'vitest';
import { spaFallbackWriteNote } from '../src/server/AgentV3/SpaFallbackAnalysis';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const ROUTER = "import { BrowserRouter, Routes, Route } from 'react-router-dom';\nexport default function App(){return <BrowserRouter><Routes><Route path='/result' element={<div/>}/></Routes></BrowserRouter>;}\n";
const SERVER_NO_FALLBACK = "import express from 'express';\nconst app = express();\napp.post('/api/convert', (_q, r) => r.json({ ok: true }));\napp.use(express.static('dist'));\napp.listen(3000);\n";
const SERVER_OK = SERVER_NO_FALLBACK.replace("app.listen(3000);", "app.get('*', (_q, r) => r.sendFile('index.html', { root: 'dist' }));\napp.listen(3000);");

describe('a server written without the SPA catch-all is told so at the write (failedbr #1803, #1801)', () => {
  it('pure: the note names the file and carries the snippet', () => {
    const note = spaFallbackWriteNote({ 'server.ts': SERVER_NO_FALLBACK }, { 'src/App.tsx': ROUTER });
    expect(note).toMatch(/Server check after this write: server\.ts serves the built client but has no catch-all/);
    expect(note).toMatch(/after every API route/);
  });

  it('pure: silent for a server with a catch-all, a project with no client router, and a non-server write', () => {
    expect(spaFallbackWriteNote({ 'server.ts': SERVER_OK }, { 'src/App.tsx': ROUTER })).toBe('');
    expect(spaFallbackWriteNote({ 'server.ts': SERVER_NO_FALLBACK }, { 'src/App.tsx': 'export default () => null;' })).toBe('');
    expect(spaFallbackWriteNote({ 'src/App.tsx': ROUTER }, { 'server.ts': SERVER_NO_FALLBACK })).toBe('');
  });

  it('🔴 through write_file: the builder is told in the tool result', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/App.tsx', ROUTER);
    const res = await d.dispatch(toolCall('write_file', { path: 'server.ts', content: SERVER_NO_FALLBACK }, 's'), 'backend');
    expect(JSON.stringify(res)).toMatch(/Server check after this write/);
  });
});
