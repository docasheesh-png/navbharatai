import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeSpaFallback, spaFallbackSnippet } from './SpaFallbackAnalysis';

const SERVER = `
import express from 'express';
const app = express();
app.use('/api/users', usersRouter);
app.listen(process.env.PORT || 3000);
`;
const CLIENT = `
import { BrowserRouter, Route } from 'react-router-dom';
export default function App() { return <BrowserRouter><Route path="/dashboard" /></BrowserRouter>; }
`;

describe('the bug it exists to catch', () => {
  it('flags an Express server with client routes and no catch-all', () => {
    // Open /dashboard directly, or reload there, and Express answers "Cannot GET /dashboard".
    const found = analyzeSpaFallback({ 'server/index.js': SERVER, 'src/App.jsx': CLIENT });
    expect(found).toMatchObject({ file: 'server/index.js', routerFile: 'src/App.jsx', servesStatic: false });
    expect(found!.message).toContain('Cannot GET');
  });

  it('says something different when the client IS served but the catch-all is missing', () => {
    // Different cause, different fix — one message for both would send the user to the wrong place.
    const served = SERVER.replace('app.listen', "app.use(express.static('dist'));\napp.listen");
    const found = analyzeSpaFallback({ 'server/index.js': served, 'src/App.jsx': CLIENT });
    expect(found?.servesStatic).toBe(true);
    expect(found!.message).toContain('serves the built client but has no catch-all');
  });
});

describe('it stays silent when the code is already right', () => {
  const withClient = (server: string) => analyzeSpaFallback({ 'server/index.js': server, 'src/App.jsx': CLIENT });

  it('accepts the spellings people actually write', () => {
    // A check that knows one spelling reports a bug in correct code — worse than not checking.
    for (const fallback of [
      "app.get('*', (req, res) => res.sendFile('index.html'));",
      "app.get('/*splat', (req, res) => res.sendFile('index.html'));",     // Express 5
      "app.get(/.*/, (req, res) => res.sendFile('index.html'));",          // regex route
      "app.use((req, res) => { res.sendFile(path.join(dist, 'index.html')); });",
      "import history from 'connect-history-api-fallback'; app.use(history());",
    ]) {
      expect(withClient(SERVER.replace('app.listen', `${fallback}\napp.listen`)), fallback).toBeNull();
    }
  });

  it('is not fooled by a fallback that is commented out', () => {
    // The comment looks like the fix and does nothing — exactly the case a naive text match misses.
    const commented = SERVER.replace('app.listen', "// app.get('*', (req, res) => res.sendFile('index.html'));\napp.listen");
    expect(withClient(commented)).not.toBeNull();
  });
});

describe('it never fires where the bug cannot happen', () => {
  it('ignores an API-only service — there are no client routes to serve', () => {
    expect(analyzeSpaFallback({ 'server/index.js': SERVER })).toBeNull();
  });

  it('ignores a client with no Express server — a dev server already handles this', () => {
    expect(analyzeSpaFallback({ 'src/App.jsx': CLIENT })).toBeNull();
  });

  it('ignores HASH routing, where the path never reaches the server at all', () => {
    // Flagging these would be a false positive, and false positives teach people to ignore the check.
    const hash = `import { HashRouter } from 'react-router-dom'; export default () => <HashRouter/>;`;
    expect(analyzeSpaFallback({ 'server/index.js': SERVER, 'src/App.jsx': hash })).toBeNull();
  });

  it('ignores a router module that never listens — that is not the server', () => {
    const routerOnly = `import express from 'express'; const app = express(); export default app;`;
    expect(analyzeSpaFallback({ 'server/routes.js': routerOnly, 'src/App.jsx': CLIENT })).toBeNull();
  });

  it('reports once, not once per file', () => {
    const found = analyzeSpaFallback({
      'server/index.js': SERVER,
      'src/App.jsx': CLIENT,
      'src/pages/Home.jsx': `import { useNavigate } from 'react-router-dom';`,
    });
    expect(found).not.toBeNull();
    expect(typeof found).toBe('object');
  });

  it('survives junk input without throwing', () => {
    expect(analyzeSpaFallback({})).toBeNull();
    expect(analyzeSpaFallback(null as never)).toBeNull();
    expect(analyzeSpaFallback({ 'a.js': undefined as never })).toBeNull();
  });
});

describe('spaFallbackSnippet — the fix, and the ordering that matters', () => {
  it('warns that the catch-all must come last, because first it breaks the API', () => {
    // Registered before the API routes, the catch-all answers the app's own fetch calls with HTML —
    // turning a routing bug into a broken API, which is strictly worse.
    const snippet = spaFallbackSnippet({ file: 's.js', routerFile: 'a.jsx', servesStatic: true, message: '' });
    expect(snippet).toContain('MUST come after');
    expect(snippet).toContain('index.html');
  });

  it('adds the static line only when the server is not already serving the client', () => {
    const needsStatic = spaFallbackSnippet({ file: 's.js', routerFile: 'a.jsx', servesStatic: false, message: '' });
    expect(needsStatic).toContain('express.static');
    const alreadyStatic = spaFallbackSnippet({ file: 's.js', routerFile: 'a.jsx', servesStatic: true, message: '' });
    expect(alreadyStatic).not.toContain('express.static');
  });
});

describe('both halves are wired — prevention and the net underneath', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

  it('the builder prompt REQUIRES the fallback, which is the half that matters', () => {
    // Preventing the bug beats detecting it: a build that never creates it needs no repair pass.
    const prompt = read('src/server/AgentV3/systemPrompt.ts');
    expect(prompt).toContain('THE SERVER MUST SERVE THE CLIENT');
    expect(prompt).toContain('Cannot GET /dashboard');
    // The ordering warning has to travel with the rule, or the "fix" breaks the API instead.
    expect(prompt).toContain('the catch-all goes AFTER');
  });

  it('the build report names the cause instead of only reporting the symptom', () => {
    // Before this, the preview verifier said "it did not render" and the autopsy had to guess why.
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("code: 'SPA_FALLBACK_MISSING'");
    expect(route).toContain('analyzeSpaFallback(integrityFiles)');
    // The exact snippet goes into the detail, which is what makes it an instruction and not a hint.
    expect(route).toContain('spaFallbackSnippet(spa)');
  });

  it('it is reported, never auto-written into a file we did not write', () => {
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf("code: 'SPA_FALLBACK_MISSING'");
    const block = route.slice(at - 900, at);
    expect(block).toContain('Reported, not auto-written');
    // autoResolved:false — claiming we fixed something we only described would be a false verdict.
    expect(route.slice(at, at + 400)).not.toContain('autoResolved: true');
  });
});
