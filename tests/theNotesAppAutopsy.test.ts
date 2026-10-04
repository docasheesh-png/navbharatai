// Autopsy 70e030bb (2026-10-04). "An app which takes notes from online classes."
//
// The fast lane's plan listed the starter's compiler files (tsconfig.json, tsconfig.build.json,
// tsconfig.node.json, src/vite-env.d.ts) and rewrote each from the app's description. The rewrite added a
// `references` entry to a non-composite project (TS6305/TS6306) and declared `*.vue` modules in a React app,
// so the summary said "Stack: Vue". The App.tsx call put the notes behind a login with a hashed demo account
// nobody asked for, the contract gave the notes list an `onClearCompleted` prop, and "Clear Completed"
// ended up deleting every note. The journey typed into the username box and looked for it among the notes
// (RELEASE_GATE RED on a working app); the sign-in explorer could not read the hashed demo account; and the
// unused-package prune removed `uuid` but left `@types/uuid` behind.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planProvidedFiles, STARTER_COMPILER_FILES, SCAFFOLD_BOILERPLATE } from '../src/server/AgentV3/scaffoldBoilerplate';
import { runSimpleBuild, manifestSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { runOneShot } from '../src/server/AgentV3/OneShotBuilder';
import { extractFacts } from '../src/server/AgentV3/WorkspaceMemory';
import { summarizeProject } from '../src/server/AgentV3/ProjectSummary';
import { deriveJourneys, journeyScript, isCredentialForm } from '../src/server/AgentV3/journeyDerivation';
import { signInCandidates } from '../src/server/AgentV3/signInExplore';
import { pruneCandidates, typesPackageFor, MAX_PRUNE } from '../src/server/AgentV3/unusedDepPrune';
import { requestScopeNote, asksForSignIn, REQUEST_SCOPE_NOTE } from '../src/server/AgentV3/requestScope';

const STARTER = ['package.json', 'index.html', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'vite.config.ts', 'src/main.tsx', 'src/App.tsx', 'src/vite-env.d.ts', 'src/ErrorBoundary.tsx'];
const REAL_PROMPT = 'An app which takes notes from online classes';

describe('§A a plan never rewrites the starter\'s compiler files', () => {
  it('🔴 the starter\'s tsconfigs and vite-env.d.ts are provided when the workspace holds them', () => {
    const provided = planProvidedFiles(STARTER);
    for (const p of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'src/vite-env.d.ts', 'src/ErrorBoundary.tsx']) expect(provided, p).toContain(p);
    expect(provided).not.toContain('package.json');
    expect(provided).not.toContain('src/App.tsx');
  });

  it('only files the workspace lists; an empty listing keeps the old boilerplate-only answer', () => {
    expect(planProvidedFiles(['src/App.tsx'])).toEqual([]);
    expect(planProvidedFiles([])).toEqual(Object.keys(SCAFFOLD_BOILERPLATE));
    expect(STARTER_COMPILER_FILES).toContain('tsconfig.json');
  });

  it('the planner is told they are provided', () => {
    expect(manifestSystemPrompt('vite-react', STARTER)).toMatch(/PROVIDED[^\n]*tsconfig\.json/);
  });

  it('🔴 the real plan: the fast lane drops the four compiler files and writes none of them', async () => {
    const written: string[] = [];
    await runSimpleBuild({
      prompt: REAL_PROMPT, framework: 'vite-react', overallTimeoutMs: 5_000, scaffoldPaths: STARTER,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) {
          return ['src/App.tsx :: Main app', 'src/NoteList.tsx :: list', 'src/vite-env.d.ts :: Vite types',
            'tsconfig.json :: TypeScript configuration', 'tsconfig.build.json :: build config', 'tsconfig.node.json :: node config'].join('\n');
        }
        const p = /Now write THIS file in full:\n {2}(\S+)/.exec(user)?.[1] ?? '';
        return `<<<FILE ${p}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (files) => { written.push(...files.map((f) => f.path)); },
    });
    for (const p of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'src/vite-env.d.ts']) expect(written, p).not.toContain(p);
    expect(written).toContain('src/NoteList.tsx');
  });

  it('the one-shot lane drops a rewrite of them too', async () => {
    const written: string[] = [];
    await runOneShot({
      prompt: REAL_PROMPT, framework: 'vite-react', scaffoldPaths: STARTER,
      generate: async () => '<<<FILE src/App.tsx>>>\nexport default function App(){return <main>Notes</main>}\n<<<ENDFILE>>>\n<<<FILE tsconfig.json>>>\n{"references":[{"path":"./tsconfig.node.json"}]}\n<<<ENDFILE>>>',
      writeFiles: async (files) => { written.push(...files.map((f) => f.path)); },
    } as never);
    expect(written).toContain('src/App.tsx');
    expect(written).not.toContain('tsconfig.json');
  });
});

describe('§B a declaration file names no dependency, and a React app is not "Stack: Vue"', () => {
  const VITE_ENV = "/// <reference types=\"vite/client\" />\ndeclare module '*.vue' {\n  import type { DefineComponent } from 'vue';\n  const component: DefineComponent<{}, {}, any>;\n  export default component;\n}\n";

  it('🔴 the real vite-env.d.ts', () => {
    expect(extractFacts('src/vite-env.d.ts', VITE_ENV).dependencies).toEqual([]);
    expect(extractFacts('src/shim.ts', "import type { DefineComponent } from 'vue';\n").dependencies).toContain('vue');
  });

  it('a React app whose graph names vue but holds no .vue file is React', () => {
    const graph = { files: ['src/App.tsx', 'src/main.tsx'], symbols: [], components: ['App'], routes: [], imports: {}, dependencies: ['react', 'react-dom', 'vite', 'vue'] } as never;
    expect(summarizeProject(graph, REAL_PROMPT)).toContain('Stack: React + Vite');
  });

  it('a real Vue app is still Vue, and a real Svelte app still Svelte', () => {
    const vue = { files: ['src/App.vue', 'src/main.ts'], symbols: [], components: [], routes: [], imports: {}, dependencies: ['vue', 'vite'] } as never;
    expect(summarizeProject(vue, 'x')).toContain('Stack: Vue');
    const mixed = { files: ['src/App.vue', 'src/Widget.tsx'], symbols: [], components: [], routes: [], imports: {}, dependencies: ['vue', 'react'] } as never;
    expect(summarizeProject(mixed, 'x')).toContain('Stack: Vue');
    const svelte = { files: ['src/App.svelte'], symbols: [], components: [], routes: [], imports: {}, dependencies: ['svelte'] } as never;
    expect(summarizeProject(svelte, 'x')).toContain('Stack: Svelte');
  });
});

describe('§C a form that asks for a password is a sign-in, not a way to add an item', () => {
  const NOTES_APP: Record<string, string> = {
    'src/App.tsx': `
      import { useState } from 'react';
      export default function App() {
        const [loggedIn, setLoggedIn] = useState(false);
        const [username, setUsername] = useState('');
        const [password, setPassword] = useState('');
        const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
        const login = (e) => { e.preventDefault(); setLoggedIn(true); setNotes([...notes, { id: '1', title: username }]); };
        return !loggedIn ? (
          <form onSubmit={login}>
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit">Login</button>
          </form>
        ) : (
          <ul>{notes.map((n) => <li key={n.id}>{n.title}</li>)}</ul>
        );
      }`,
  };

  it('isCredentialForm reads type="password" and the password autoComplete names', () => {
    expect(isCredentialForm([{ tag: '<input type="password" />' }])).toBe(true);
    expect(isCredentialForm([{ tag: "<input type={'password'} />" }])).toBe(true);
    expect(isCredentialForm([{ tag: '<input autoComplete="current-password" />' }])).toBe(true);
    expect(isCredentialForm([{ tag: '<input name="title" />' }, { tag: '<textarea name="content" />' }])).toBe(false);
    expect(isCredentialForm([{ tag: '<input name="passwordHint" />' }])).toBe(false);
  });

  it('🔴 the login form beside the notes list is a form-submit journey driven signed out', () => {
    const js = deriveJourneys({ files: NOTES_APP, marker: 'nbai-x', routes: ['/'] });
    expect(js.length).toBeGreaterThan(0);
    expect(js.every((j) => j.kind !== 'create-persists')).toBe(true);
    const j = js[0];
    expect(j.signIn).toBe(true);
    expect(j.title).toMatch(/sign-in form/);
    const script = journeyScript('http://x', [j], 'NBAI_J', { storageState: '/tmp/nbai-signed-in.json' });
    expect(script).not.toContain('/tmp/nbai-signed-in.json');
  });

  it('an ordinary add-a-note form is still a create-persists journey', () => {
    const files = {
      'src/App.tsx': `
        import { useState } from 'react';
        export default function App() {
          const [title, setTitle] = useState('');
          const [notes, setNotes] = useState<string[]>([]);
          return (<div>
            <form onSubmit={(e) => { e.preventDefault(); setNotes([...notes, title]); }}>
              <label htmlFor="title">Title</label>
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <button type="submit">Add note</button>
            </form>
            <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>);
        }`,
    };
    const js = deriveJourneys({ files, marker: 'nbai-x', routes: ['/'] });
    expect(js[0]?.kind).toBe('create-persists');
    expect(js[0]?.signIn).toBeUndefined();
  });
});

describe('§D the sign-in explorer reads a demo password behind a hash call', () => {
  it('🔴 the real DEMO_USER', () => {
    const got = signInCandidates({ 'src/App.tsx': 'const DEMO_USER = {\n  username: "student",\n  passwordHash: hashPassword("demo123")\n};' });
    expect(got[0]).toMatchObject({ identifier: 'student', password: 'demo123' });
  });

  it('the plain shape still works, and a bare hash constant is never read as a password', () => {
    expect(signInCandidates({ 'src/a.ts': "{ email: 'a@b.co', password: 'secret1' }" })[0]).toMatchObject({ identifier: 'a@b.co', password: 'secret1' });
    expect(signInCandidates({ 'src/a.ts': 'const u = { username: "student", passwordHash: hashOf(pw) };' })).toEqual([]);
  });
});

describe('§E a package\'s types go with it', () => {
  const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) => JSON.stringify({ name: 'app', scripts: { build: 'vite build' }, dependencies: deps, devDependencies: dev });
  const BEFORE = pkg({ react: '^18.3.1' }, { vite: '^5.4.0' });
  const AFTER = pkg({ react: '^18.3.1', uuid: '^10.0.0' }, { vite: '^5.4.0', '@types/uuid': '^10.0.0' });

  it('typesPackageFor names DefinitelyTyped', () => {
    expect(typesPackageFor('uuid')).toBe('@types/uuid');
    expect(typesPackageFor('@scope/pkg')).toBe('@types/scope__pkg');
  });

  it('🔴 uuid and its @types are removed together', () => {
    expect(pruneCandidates({ before: BEFORE, after: AFTER, unused: ['uuid'], files: { 'src/App.tsx': 'export default 1' } })).toEqual(['uuid', '@types/uuid']);
  });

  it('a @types the user already had stays, and a named one keeps its package', () => {
    const had = pkg({ react: '^18.3.1' }, { vite: '^5.4.0', '@types/uuid': '^9.0.0' });
    expect(pruneCandidates({ before: had, after: AFTER, unused: ['uuid'], files: {} })).toEqual(['uuid']);
    // A file naming "@types/uuid" names "uuid" too, so the package itself stays and its types with it.
    expect(pruneCandidates({ before: BEFORE, after: AFTER, unused: ['uuid'], files: { 'tsconfig.json': '{"compilerOptions":{"types":["@types/uuid"]}}' } })).toEqual([]);
    expect(MAX_PRUNE).toBeGreaterThan(1);
  });
});

describe('§F a login nobody asked for is not built', () => {
  it('🔴 the real prompt gets the scope note on a new build', () => {
    expect(requestScopeNote({ request: REAL_PROMPT, newBuild: true, domain: 'general' }, {})).toBe(REQUEST_SCOPE_NOTE);
    expect(REQUEST_SCOPE_NOTE).toMatch(/NO login/);
    expect(REQUEST_SCOPE_NOTE).toMatch(/Clear\s+completed/);
  });

  it.each([
    'notes app with login', 'a todo app where users sign in', 'expense tracker with password protection',
    'school app with admin and teacher roles', 'a private diary', 'multi-user chat app', 'app with OTP',
    'notes app jisme लॉगिन ho', 'blog with user accounts', 'secure vault for documents', 'members-only club app',
  ])('stands down when the request asks for sign-in — %s', (p) => {
    expect(asksForSignIn(p), p).toBe(true);
    expect(requestScopeNote({ request: p, newBuild: true, domain: 'general' }, {})).toBe('');
  });

  it.each(['a calculator', 'Make biology learning app', 'An app which takes notes from online classes', 'a clock app', 'a racing game'])(
    'applies to a request that names no sign-in — %s', (p) => {
      expect(asksForSignIn(p), p).toBe(false);
    });

  it('never on an edit, never in a recognised domain, never with the switch off', () => {
    expect(requestScopeNote({ request: REAL_PROMPT, newBuild: false, domain: 'general' }, {})).toBe('');
    expect(requestScopeNote({ request: 'hospital management system', newBuild: true, domain: 'healthcare' }, {})).toBe('');
    expect(requestScopeNote({ request: REAL_PROMPT, newBuild: true, domain: 'general' }, { AGENTV3_REQUEST_SCOPE: 'off' })).toBe('');
  });

  it('🔒 White-Label: the note names no AI vendor', () => {
    expect(REQUEST_SCOPE_NOTE).not.toMatch(/\b(?:glm|kimi|claude|anthropic|gemini|grok|openai|nemotron)\b/i);
  });

  it('REVERSION GUARD: the architect, the fast lane and the one-shot lane all read it', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('requestScopeNote({ request: planning.text, newBuild: intent === \'new_build\' && !isImportTurn, domain: analyzeRequirementGaps(planning.text).domain })');
    expect(src).toContain('buildPrompt = `${requestScopeText}\\n\\n---\\n\\n${buildPrompt}`;');
    expect(src).toContain('unknownNameSuffix + requestScopeSuffix,');
    expect(src).toContain('runOneShot({ prompt: prompt + unknownNameSuffix + requestScopeSuffix,');
  });
});
