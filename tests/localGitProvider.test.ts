/**
 * Tests for LocalGitProvider — pure validation paths that execute before git I/O.
 * Uses a mock IEventBus and a real temp directory so simpleGit can construct
 * without throwing "directory does not exist".
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalGitProvider } from '../src/server/AppMakerLab/vcs/LocalGitProvider';
import { ValidationError, PersistenceError } from '../src/server/AppMakerLab/errors/AppMakerErrors';

function makeEventBus() {
  return {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
}

// A real directory so simpleGit(path) does not throw on construction
let tmpRoot: string;
let wsId: string;

beforeAll(() => {
  // e.g. /tmp/lgp-test-ABC123 → root=/tmp, wsId=lgp-test-ABC123
  const fullTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgp-test-'));
  tmpRoot = path.dirname(fullTmp);
  wsId = path.basename(fullTmp);
});

afterAll(() => {
  try { fs.rmSync(path.join(tmpRoot, wsId), { recursive: true, force: true }); } catch {}
});

describe('LocalGitProvider — clone() protocol validation', () => {
  it('rejects git:// protocol (wraps in PersistenceError)', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.clone(wsId, 'git://github.com/foo/bar', 'corr-1')
    ).rejects.toThrow(PersistenceError);
  });

  it('rejects ssh:// protocol', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.clone(wsId, 'ssh://github.com/foo/bar', 'corr-1')
    ).rejects.toThrow(PersistenceError);
  });

  it('rejects file:// protocol', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.clone(wsId, 'file:///etc/passwd', 'corr-1')
    ).rejects.toThrow(PersistenceError);
  });
});

describe('LocalGitProvider — clone() hostname validation', () => {
  it('rejects localhost hostname', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.clone(wsId, 'http://localhost/owner/repo', 'corr-1')
    ).rejects.toThrow(PersistenceError);
  });

  it('rejects 127.0.0.1 hostname', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.clone(wsId, 'http://127.0.0.1/owner/repo', 'corr-1')
    ).rejects.toThrow(PersistenceError);
  });
});

describe('LocalGitProvider — createBranch() name validation', () => {
  it('throws ValidationError for branch name with spaces (no correlationId → raw re-throw)', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.createBranch(wsId, 'invalid branch name')
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for branch name with "!"', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.createBranch(wsId, 'branch#name!')
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for branch name with "@"', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.createBranch(wsId, 'user@host')
    ).rejects.toThrow(ValidationError);
  });

  it('does NOT throw ValidationError for valid name "feature/auth-v2"', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    try {
      await provider.createBranch(wsId, 'feature/auth-v2');
    } catch (e) {
      // git I/O fails (not a real repo) — must not be a validation error
      expect(e).not.toBeInstanceOf(ValidationError);
    }
  });
});

describe('LocalGitProvider — commit() author validation', () => {
  it('throws ValidationError when author name contains "<"', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.commit(wsId, 'msg', { name: '<injected>', email: 'user@example.com' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when author name contains ">"', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.commit(wsId, 'msg', { name: 'Bad>Name', email: 'user@example.com' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid email (no @)', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    await expect(
      provider.commit(wsId, 'msg', { name: 'Good User', email: 'notanemail' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for author name exceeding 100 characters', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    const longName = 'x'.repeat(101);
    await expect(
      provider.commit(wsId, 'msg', { name: longName, email: 'user@example.com' })
    ).rejects.toThrow(ValidationError);
  });

  it('does NOT throw ValidationError for valid author (git I/O may fail)', async () => {
    const provider = new LocalGitProvider(tmpRoot, makeEventBus() as any);
    try {
      await provider.commit(wsId, 'Initial commit', { name: 'Alice', email: 'alice@example.com' });
    } catch (e) {
      expect(e).not.toBeInstanceOf(ValidationError);
    }
  });
});
