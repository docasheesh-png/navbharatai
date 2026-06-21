import { describe, it, expect } from 'vitest';
import { workspaceMemoryStore } from '../src/server/EngineerAI/WorkspaceMemoryStore';

describe('workspaceMemoryStore (VITEST-skip mode)', () => {
  it('save() does not throw in test environment', async () => {
    await expect(workspaceMemoryStore.save('ws-1', 'memory content')).resolves.not.toThrow();
  });

  it('load() returns null in test environment (no Firestore)', async () => {
    const result = await workspaceMemoryStore.load('ws-1');
    expect(result).toBeNull();
  });
});
