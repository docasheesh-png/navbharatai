import { describe, it, expect, vi } from 'vitest';
import { recordingActuator } from './recordedWrites';
import { runWithToolSignal } from './toolDeadline';

describe('optional genuine CAS is guarded and recorded', () => {
  it('records the new contents only after a successful expected-version replacement', async () => {
    const files = new Map([['src/object.ts', 'original']]);
    const inner = {
      async writeFile() {},
      async compareAndSwapFile(_ws: string, p: string, expected: string, content: string) {
        if (files.get(p) !== expected) throw new Error('stale expected version');
        files.set(p, content);
      },
    };
    const record = vi.fn(); const guard = vi.fn();
    const wrapped = recordingActuator(inner, 'w', record, guard);
    await wrapped.compareAndSwapFile('w', 'src/object.ts', 'original', 'updated');
    expect(guard).toHaveBeenCalledWith('src/object.ts');
    expect(record).toHaveBeenCalledExactlyOnceWith('src/object.ts', 'updated');
    await expect(wrapped.compareAndSwapFile('w', 'src/object.ts', 'original', 'stale')).rejects.toThrow('stale');
    expect(record).toHaveBeenCalledTimes(1);
    expect(files.get('src/object.ts')).toBe('updated');
  });

  it('refuses a lapsed tool before the actuator or recorder is called', async () => {
    const compareAndSwapFile = vi.fn(async () => {}); const record = vi.fn();
    const wrapped = recordingActuator({ writeFile: async () => {}, compareAndSwapFile }, 'w', record);
    const controller = new AbortController(); controller.abort();
    await expect(runWithToolSignal(controller.signal, () => wrapped.compareAndSwapFile())).rejects.toThrow('LAPSED');
    expect(compareAndSwapFile).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a denied write before the actuator or recorder is called', async () => {
    const compareAndSwapFile = vi.fn(async () => {}); const record = vi.fn();
    const wrapped = recordingActuator({ writeFile: async () => {}, compareAndSwapFile }, 'w', record, () => { throw new Error('denied'); });
    await expect(wrapped.compareAndSwapFile()).rejects.toThrow('denied');
    expect(compareAndSwapFile).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('does not invent an atomic capability when the actuator has none', () => {
    const wrapped = recordingActuator({ writeFile: async () => {} }, 'w', vi.fn());
    expect('compareAndSwapFile' in wrapped).toBe(false);
  });
});
