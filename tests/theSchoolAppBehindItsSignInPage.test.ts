/**
 * Q-540 (autopsy 68f0a486, "Gyan Spark Academy"): the school app kept its users in localStorage and shipped
 * no demo account, so nothing behind its sign-in page — fees, attendance, uploads — was ever opened, while
 * the summary said they worked. The admin chose option (b) on 2026-10-04: the check may sign up ONE
 * throwaway account, but only where the app's accounts live in the browser alone. An app with a real
 * backend keeps the old rule — no account is ever created there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  authLivesInTheBrowser, signInScript, signInModule, parseSignInOutput, signInReportLine, SIGN_IN_RESULT_MARKER,
} from '../src/server/AgentV3/signInExplore';
import { makeTempDir } from './helpers/tempDir';

/** The report's shape: an auth context over localStorage, a password form, no server. */
const SCHOOL = {
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.26.0' } }),
  'src/context/AuthContext.tsx': `const USERS_KEY = 'gyan_users';
export function register(name: string, email: string, password: string) {
  const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  users.push({ name, email, password });
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}`,
  'src/pages/Login.tsx': 'export default function Login(){ return <form><input type="email" /><input type="password" /><button type="submit">Sign in</button></form>; }',
  'src/api/students.ts': "export const list = () => JSON.parse(localStorage.getItem('students') || '[]');",
};

describe('whose accounts live in the browser alone', () => {
  it('the school app: accounts in localStorage, no server — yes', () => {
    expect(authLivesInTheBrowser(SCHOOL)).toBe(true);
  });

  it('any sign of a server, hosted auth, a hosted database or our shared rows — no', () => {
    const with_ = (path: string, content: string) => ({ ...SCHOOL, [path]: content });
    const cases: Array<[string, Record<string, string>]> = [
      ['supabase', with_('src/lib/supabase.ts', "import { createClient } from '@supabase/supabase-js';")],
      ['firebase dependency', with_('package.json', JSON.stringify({ dependencies: { react: '1', firebase: '^10' } }))],
      ['clerk', with_('src/main.tsx', "import { ClerkProvider } from '@clerk/clerk-react';")],
      ['NavData shared rows', with_('src/lib/db.ts', 'await window.NavData.add("users", u);')],
      ['a sign-in request', with_('src/lib/auth.ts', "await fetch('/api/login', { method: 'POST' });")],
      ['an axios sign-up', with_('src/lib/auth.ts', "axios.post(`${base}/auth/register`, body)")],
      ['an API base URL', with_('src/lib/http.ts', 'const base = import.meta.env.VITE_API_URL;')],
      ['a server directory', with_('server/index.js', 'module.exports = {}')],
      ['a root api function', with_('api/users.ts', 'export default () => {}')],
      ['an express server', with_('package.json', JSON.stringify({ dependencies: { react: '1', express: '^4' } }))],
      ['a database url', with_('.env', 'DATABASE_URL=postgres://x')],
    ];
    for (const [name, files] of cases) expect(authLivesInTheBrowser(files), name).toBe(false);
  });

  it('no positive evidence — no (uncertain keeps the old rule)', () => {
    expect(authLivesInTheBrowser({})).toBe(false);
    expect(authLivesInTheBrowser({ 'src/App.tsx': 'export default () => <input type="password" />' })).toBe(false);
    expect(authLivesInTheBrowser({ 'src/App.tsx': "localStorage.setItem('theme', 'dark')" })).toBe(false);
  });
});

describe('the server decides, the script obeys', () => {
  it('the script may create an account only when told to', () => {
    expect(signInScript('http://x/', [])).toContain('"mayCreateAccount":false');
    expect(signInScript('http://x/', [], { mayCreateAccount: true })).toContain('"mayCreateAccount":true');
  });

  it('the route asks the detector, with the same files the candidates come from', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('signInScript(previewUrl, signInCandidates(files), { mayCreateAccount: authLivesInTheBrowser(files) })');
  });

  it('the report says where the account came from, never what it is', () => {
    const line = signInReportLine({ ran: true, signedIn: true, note: 'a throwaway account the check created — the app keeps its accounts in the browser only', screens: [] });
    expect(line.message).toContain('throwaway account');
    expect(line.message).not.toMatch(/@example\.com|Nb-check/);
  });
});

// ── A REAL BROWSER, where one exists (skipped visibly in CI, like the other in-browser checks) ──────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

/**
 * A school app shaped like the report's: users in localStorage, a "Create account" switch that shows a
 * register form (name, email, role, password, confirm), and — like most apps — back to sign-in afterwards.
 * `signUpSignsIn` makes the other common shape: a new account is signed in at once.
 */
function school(signUpSignsIn: boolean): string {
  return `<!doctype html><html><body><div id="root"></div><script>
const root = document.getElementById('root');
const users = () => JSON.parse(localStorage.getItem('gyan_users') || '[]');
function render(mode) {
  if (localStorage.getItem('gyan_session')) {
    const nav = '<nav><a href="/dashboard">Dashboard</a><a href="/fees">Fees</a><a href="/attendance">Attendance</a><a href="/logout">Log out</a></nav>';
    if (location.pathname === '/fees') root.innerHTML = nav + '<h1>Fee Records</h1><table><tr><td>Class 5</td><td>1200</td></tr></table>';
    else if (location.pathname === '/attendance') root.innerHTML = nav + '<h1>Attendance</h1>';
    else root.innerHTML = nav + '<h1>Dashboard</h1>';
    return;
  }
  if (mode === 'register') {
    root.innerHTML = '<h1>Create your account</h1><form id="r"><input name="fullName" placeholder="Full name" required>'
      + '<input type="email" name="email" placeholder="Email" required><select name="role" required><option value="">Choose role</option><option value="teacher">Teacher</option></select>'
      + '<input type="password" name="password" required minlength="8"><input type="password" name="confirm" required>'
      + '<button type="submit">Register</button></form>';
    document.getElementById('r').onsubmit = function (ev) {
      ev.preventDefault();
      const f = ev.target;
      if (f.password.value !== f.confirm.value || !f.role.value) { root.insertAdjacentHTML('beforeend', '<p role="alert">Check the form</p>'); return; }
      const list = users(); list.push({ email: f.email.value, password: f.password.value });
      localStorage.setItem('gyan_users', JSON.stringify(list));
      if (${signUpSignsIn}) { localStorage.setItem('gyan_session', f.email.value); history.pushState({}, '', '/dashboard'); }
      render('login');
    };
    return;
  }
  root.innerHTML = '<h1>Gyan Spark Academy</h1><form id="l"><input type="email" id="e"><input type="password" id="p"><button type="submit">Sign in</button></form>'
    + '<p>New here? <button id="go" type="button">Create account</button></p>';
  document.getElementById('go').onclick = function () { render('register'); };
  document.getElementById('l').onsubmit = function (ev) {
    ev.preventDefault();
    const ok = users().some(function (u) { return u.email === document.getElementById('e').value && u.password === document.getElementById('p').value; });
    if (ok) { localStorage.setItem('gyan_session', '1'); history.pushState({}, '', '/dashboard'); render(); }
    else root.insertAdjacentHTML('beforeend', '<p role="alert">Wrong email or password</p>');
  };
}
render('login');
</script></body></html>`;
}

describe.skipIf(!haveBrowser)('in a real browser', () => {
  const servers: http.Server[] = [];
  let backToSignIn = '';
  let signsInAtOnce = '';
  const start = async (signUpSignsIn: boolean) => {
    const s = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(school(signUpSignsIn)); });
    await new Promise<void>((res) => s.listen(0, '127.0.0.1', () => res()));
    servers.push(s);
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
  };
  beforeAll(async () => { backToSignIn = await start(false); signsInAtOnce = await start(true); });
  afterAll(async () => { for (const s of servers) await new Promise<void>((res) => s.close(() => res())); });

  async function runNode(source: string): Promise<string> {
    const dir = makeTempDir('nbai-signup-real-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, source);
    const { execFile } = await import('node:child_process');
    return new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
  }
  const imp = `import playwright from '${PW}';\nconst { chromium } = playwright;`;
  const signIn = async (base: string, mayCreateAccount: boolean) => {
    const out = await runNode(signInModule({ base, marker: SIGN_IN_RESULT_MARKER, state: join(makeTempDir('nbai-state-'), 's.json'), maxScreens: 6, budgetMs: 45_000, candidates: [], mayCreateAccount }, imp));
    return { out, run: parseSignInOutput(out) };
  };

  it('a browser-only app: signs up a throwaway account, signs in with it, and reads the screens behind the door', async () => {
    const { out, run } = await signIn(backToSignIn, true);
    expect(run.signedIn).toBe(true);
    expect(run.note).toMatch(/throwaway account/);
    expect(run.screens.map((s) => s.path)).toEqual(expect.arrayContaining(['/fees', '/attendance']));
    expect(run.screens.map((s) => s.path)).not.toContain('/logout');
    expect(run.screens.find((s) => s.path === '/fees')!.html).toContain('Fee Records');
    expect(out).not.toMatch(/Nb-check-/); // the password is never printed
  }, 120_000);

  it('the shape where a new account is signed in at once', async () => {
    const { run } = await signIn(signsInAtOnce, true);
    expect(run.signedIn).toBe(true);
    expect(run.screens.map((s) => s.path)).toContain('/fees');
  }, 120_000);

  it('not told it may — no account is created, and the note says why', async () => {
    const { run } = await signIn(backToSignIn, false);
    expect(run.signedIn).toBe(false);
    expect(run.note).toMatch(/creates its own account only in an app that keeps its accounts in the browser alone/);
  }, 120_000);
});
