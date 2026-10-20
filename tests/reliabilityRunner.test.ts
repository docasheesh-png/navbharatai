import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

describe('live benchmark protocol against a local scripted server (no provider calls)', () => {
  it.each([200, 401])('authenticates, checkpoints and records the truthful outcome for HTTP %s', async (status) => {
    const output = await mkdtemp(join(tmpdir(), 'reliability-runner-'));
    const requests: Array<{ authorization: string | undefined; body: any; pending: any }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      // Read while the HTTP request is still in flight: post-response checkpointing is too late
      // to reconcile a runner killed during a paid build.
      const checkpointFiles = await readdir(output);
      const checkpoint = JSON.parse(await readFile(join(output, checkpointFiles[0]), 'utf8'));
      requests.push({ authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()), pending: checkpoint.runs[0] });
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(status === 200 ? [
        { type: 'file_changed', change: { path: 'src/App.tsx' } },
        { type: 'result', ok: false },
        { type: 'done', ok: true },
      ].map((e) => JSON.stringify(e)).join('\n') : 'Do not copy this response into artifacts');
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const address = server.address() as { port: number };
    try {
      let failed = false;
      try {
        await execute(process.execPath, ['--import', 'tsx', 'scripts/agentv3-reliability-bench.ts'], {
          cwd: resolve(__dirname, '..'),
          env: { ...process.env, BENCH_BASE_URL: `http://127.0.0.1:${address.port}`, BENCH_AUTH_TOKEN: 'test-only-token',
            BENCH_USER_ID: 'test-only-user', BENCH_CONFIRM: 'yes', BENCH_ONLY: 'todo-hinglish',
            BENCH_SET: 'smoke', BENCH_RUNS: status === 401 ? '3' : '1', BENCH_OUTPUT_DIR: output },
        });
      } catch { failed = true; }
      expect(failed).toBe(status === 401);
      expect(requests).toHaveLength(1); // Authentication refusal must stop a batch, not poison every row.
      expect(requests[0].authorization).toBe('Bearer test-only-token');
      expect(requests[0].pending).toMatchObject({ requestId: requests[0].body.requestId,
        sessionId: requests[0].body.sessionId, failure: 'request-in-progress', success: false });
      expect(requests[0].pending.metrics.billedUsd).toBeNull();
      const files = await readdir(output);
      expect(files).toHaveLength(1); // Atomic checkpoint leaves no pending temp file.
      const bytes = await readFile(join(output, files[0]), 'utf8');
      expect(bytes).not.toContain('test-only-token');
      expect(bytes).not.toContain('Do not copy this response');
      const artifact = JSON.parse(bytes);
      expect(artifact.execution.status).toBe(status === 200 ? 'complete' : 'blocked');
      expect(artifact.execution.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.execution.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(artifact.runs[0]).toMatchObject({ success: false,
        requestId: requests[0].body.requestId, sessionId: requests[0].body.sessionId });
      if (status === 401) expect(artifact.runs[0].metrics.billedUsd).toBeNull();
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);
});
