import { describe, it, expect } from 'vitest';
import { previewGuard, previewGuardMessage } from './PreviewGuard';

describe('previewGuard — redirects manual preview/dev-server improvisation', () => {
  it('redirects the crude alternatives the agent reaches for when the preview looks blank', () => {
    const improv = [
      'npx serve dist -l 3000 --no-clipboard',
      'npx serve dist -l tcp://0.0.0.0:3001',
      'serve dist',
      'npx vite preview --host 0.0.0.0 --port 4174',
      'vite preview',
      'pkill -f "vite"',
      'pkill -f vite',
      'killall node',
      'python3 -m http.server 8000',
      'http-server dist -p 8080',
    ];
    for (const cmd of improv) {
      expect(previewGuard(cmd).redirect, cmd).toBe(true);
      expect(previewGuard(cmd).reason, cmd).toBeTruthy();
    }
  });

  it('NEVER redirects the legitimate managed dev-server start / ordinary build commands', () => {
    const ok = [
      'npm run dev',
      'npm run dev -- --host 0.0.0.0 --port 5173',
      'npx vite',
      'npx vite --host 0.0.0.0 --port 5173',
      'vite --host',
      'npm install',
      'npm run build',
      'npx tsc --noEmit',
      'cat vite.config.ts',
      'ls -la',
      'curl -s http://localhost:5173',
      'grep -r "serve" src', // mentions "serve" inside args but is a grep, not a serve
    ];
    for (const cmd of ok) {
      expect(previewGuard(cmd).redirect, cmd).toBe(false);
    }
  });

  it('empty / whitespace command is never a redirect', () => {
    expect(previewGuard('').redirect).toBe(false);
    expect(previewGuard('   ').redirect).toBe(false);
  });

  it('the redirect message names the ONE managed path and forbids the crude tricks', () => {
    const msg = previewGuardMessage('reason here');
    expect(msg).toContain('npm run dev');
    expect(msg).toMatch(/Preview tab/);
    expect(msg).toMatch(/preview guard/i);
  });
});
