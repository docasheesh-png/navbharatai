import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerAgentV3Routes } from '../src/server/routes/agentv3';
import { terminalRequiresVerified } from '../src/server/lib/identityPolicy';

/**
 * GT-20 / BLD-7 (access only). The terminal and exec used the userId in the body.
 * They now use only verifiedIdentity. D-4: the sign-in requirement defaults ON.
 */
const routes = captureRoutes(registerAgentV3Routes);
const open = routes.get('POST /api/agentv3/shell/open')!;

const saved = {
  enabled: process.env.AGENTV3_ENABLED,
  allow: process.env.AGENTV3_ALLOWLIST,
  flag: process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED,
};

beforeAll(() => {
  process.env.AGENTV3_ENABLED = 'true';
});

afterEach(() => {
  process.env.AGENTV3_ENABLED = saved.enabled;
  process.env.AGENTV3_ALLOWLIST = saved.allow;
  if (saved.flag === undefined) delete process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED;
  else process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED = saved.flag;
  process.env.AGENTV3_ENABLED = 'true';
});

describe('the terminal trusts only a verified user', () => {
  it('default is on; only an explicit off turns the gate down', () => {
    expect(terminalRequiresVerified({} as NodeJS.ProcessEnv)).toBe(true);
    expect(terminalRequiresVerified({ AGENTV3_TERMINAL_REQUIRE_VERIFIED: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('(a) a claimed allowlisted uid with no verified header is 401', async () => {
    process.env.AGENTV3_ALLOWLIST = 'allowlisted-uid';
    delete process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED;
    const res = mockRes();
    await open(mockReq({
      body: { userId: 'allowlisted-uid', email: 'a@b.c', workspaceId: 'agentv3-anon-pr15' },
    }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Sign in to use the terminal.');
  });

  it('(b) a verified header gets past the identity gate', async () => {
    process.env.AGENTV3_ALLOWLIST = '';
    delete process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED;
    const res = mockRes();
    await open(mockReq({
      body: { workspaceId: 'agentv3-anon-pr15' },
      headers: { 'x-test-verified-uid': 'user-1', 'x-test-verified-email': 'user-1@example.com' },
    }), res);
    expect(res.statusCode).not.toBe(401);
  });

  it('(c) flag off, no header, an anon workspace is not refused for identity', async () => {
    process.env.AGENTV3_ALLOWLIST = '';
    process.env.AGENTV3_TERMINAL_REQUIRE_VERIFIED = 'off';
    const res = mockRes();
    await open(mockReq({
      body: { workspaceId: 'agentv3-anon-pr15' },
    }), res);
    expect(res.statusCode).not.toBe(401);
  });

  it('(d) the listed handlers do not read a claimed userId', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const spans: Array<[string, string]> = [
      ["app.post('/api/agentv3/exec'", "app.get('/api/agentv3/runtime-logs'"],
      ["app.post('/api/agentv3/shell/open'", "app.get('/api/agentv3/shell/wake'"],
      ["app.get('/api/agentv3/shell/wake'", "app.get('/api/agentv3/shell/stream'"],
      ["app.get('/api/agentv3/shell/stream'", "app.post('/api/agentv3/shell/input'"],
      ["app.post('/api/agentv3/shell/input'", "app.post('/api/agentv3/shell/resize'"],
      ["app.post('/api/agentv3/shell/resize'", "app.post('/api/agentv3/shell/close'"],
      ["app.post('/api/agentv3/shell/close'", "app.get('/api/agentv3/deployment'"],
    ];
    for (const [start, end] of spans) {
      const body = src.slice(src.indexOf(start), src.indexOf(end));
      expect(body.length, start).toBeGreaterThan(50);
      expect(body, start).not.toContain('req.body?.userId');
      expect(body, start).not.toContain('req.body.userId');
      expect(body, start).not.toContain('req.query.userId');
      expect(body, start).not.toContain('req.query?.userId');
      expect(body, start).toContain('verifiedIdentity(req)');
    }
    expect(readFileSync(join(process.cwd(), 'src/components/ide/ShellTerminal.tsx'), 'utf8')).toContain('authedHeaders(');
    expect(readFileSync(join(process.cwd(), 'src/components/ide/ShellTerminal.tsx'), 'utf8')).toContain('Sign in to use the terminal.');
  });
});
