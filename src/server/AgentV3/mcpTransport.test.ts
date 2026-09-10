import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listRemoteTools, callRemoteTool, MCP_TIMEOUT_MS, MCP_MAX_RESPONSE_BYTES } from './mcpTransport';
import { toSafeTools } from './mcpClient';

const src = readFileSync(resolve(__dirname, 'mcpTransport.ts'), 'utf8');

describe('🔒 SSRF — the guard that stands between a connect form and our own network', () => {
  it('refuses a private / loopback / metadata address, without saying what it found', async () => {
    // These are the real targets: 169.254.169.254 is cloud metadata (credentials), localhost is
    // whatever else runs beside us. The guard runs for real here — no mock — so this exercises the
    // actual path a user's URL takes.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8080/mcp',
      'http://127.0.0.1/mcp',
      'http://[::1]/mcp',
      'http://10.0.0.5/mcp',
      'http://192.168.1.1/mcp',
    ]) {
      const r = await listRemoteTools({ id: 's', url });
      expect(r.tools).toEqual([]);
      expect(r.error).toBeTruthy();
      // A precise refusal would make this form a port scanner for our own network.
      expect(r.error).not.toMatch(/private|internal|localhost|127\.|169\.254|metadata|resolve|reserved/i);
    }
  });

  it('refuses a non-http scheme', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x']) {
      expect((await listRemoteTools({ id: 's', url })).tools).toEqual([]);
    }
  });

  it('refuses a malformed URL rather than throwing', async () => {
    const r = await listRemoteTools({ id: 's', url: 'not a url' });
    expect(r.tools).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('🔒 the SSRF check runs on EVERY call, not once at connect time', () => {
    // A host that resolved to a public address when the user added it can resolve elsewhere later.
    // Checking only at connect time leaves exactly that window open.
    const rpcStart = src.indexOf('async function rpc(');
    const rpcBody = src.slice(rpcStart, rpcStart + 900);
    expect(rpcBody).toContain('assertPublicHttpUrl(cfg.url)');
  });

  it('🔒 reuses the SHARED guard rather than writing a second one', () => {
    // A second SSRF implementation is a second one to get wrong. This is the same check web_fetch uses.
    expect(src).toContain("from '../lib/ssrfGuard'");
    expect(src).not.toMatch(/function\s+isPrivate|169\.254\.169\.254/);
  });
});

describe('🔒 stdio is not supported, deliberately', () => {
  it('never spawns a process', () => {
    // The MCP spec's stdio transport launches a LOCAL PROCESS from a user-supplied string, which on a
    // server is remote code execution dressed as a feature. HTTP only, and the file says why.
    expect(src).not.toMatch(/child_process|spawn\(|execFile|\bexec\(/);
    expect(src).toMatch(/never stdio/i);
  });
});

describe('every call is bounded — a stranger must not be able to hang or flood a build', () => {
  it('has a real timeout and abort', () => {
    expect(MCP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MCP_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(src).toContain('AbortController');
    expect(src).toContain('controller.abort()');
    expect(src).toContain('clearTimeout(timer)');   // in a finally, so it cannot leak
  });

  it('🔒 caps the response BEFORE parsing it', () => {
    // resp.json() on a hostile stream can exhaust memory; a size limit applied after parsing is
    // applied too late to help.
    // Compare positions INSIDE rpc(), not in the file: indexOf on the bare name finds the
    // `export const` declaration near the top and would pass or fail for the wrong reason.
    const rpcStart = src.indexOf('async function rpc(');
    const rpcBody = src.slice(rpcStart, src.indexOf('function rpcResult('));
    const readAt = rpcBody.indexOf('await resp.text()');
    const capAt = rpcBody.indexOf('raw.length > MCP_MAX_RESPONSE_BYTES');
    expect(readAt).toBeGreaterThan(-1);
    expect(capAt).toBeGreaterThan(readAt);
    // Assert on CODE, not on prose: the comment above the read names resp.json() to explain why it
    // is avoided, and a raw substring check would fail on the explanation itself.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('resp.json()');
    expect(MCP_MAX_RESPONSE_BYTES).toBeGreaterThan(0);
  });

  it('returns a result object instead of throwing, on every path', async () => {
    await expect(listRemoteTools({ id: 's', url: 'http://127.0.0.1/x' })).resolves.toBeTruthy();
    const [tool] = toSafeTools('s', [{ name: 'go' }]);
    await expect(callRemoteTool({ id: 's', url: 'http://127.0.0.1/x' }, tool, {})).resolves.toContain('could not run');
  });
});

describe('🔒 credentials', () => {
  it('sends only the headers the USER configured for their own server', () => {
    // A connected service is the user's, and so is its authentication. NavBharatAI's own secrets are
    // never in scope for a third-party server.
    expect(src).toContain('...(cfg.headers ?? {})');
    expect(src).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)/);
  });
});

describe('callRemoteTool', () => {
  it('🔒 sends the REMOTE name, never our namespaced one', () => {
    // The ext__ prefix exists to keep the model's tool list unambiguous; a server would not know it.
    expect(src).toContain('name: tool.remoteName');
    expect(src).not.toContain('name: tool.name');
  });

  it('🔒 always labels the result as outside data', () => {
    // Half the injection defence, and not something a call site may forget — so it lives here.
    expect(src).toContain('formatToolResult(tool.name');
  });
});

describe('listRemoteTools', () => {
  it('🔒 returns SAFE tools only — a caller cannot get raw ones', () => {
    // Namespacing, sanitising and capping all happen before anything leaves this function, so no
    // call site can hand the model something a stranger wrote unfiltered.
    expect(src).toContain('toSafeTools(cfg.id');
  });
});
