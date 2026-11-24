import { afterEach, describe, expect, it } from 'vitest';
import { setServerDb } from './serverDb';
import { APP_MART_PIN_LIMIT, getAppMartPins, setAppMartPin } from './appMartPins';

function fakeDb() {
  let stored: Record<string, unknown> = {};
  const ref = {
    get: async () => ({ exists: Object.keys(stored).length > 0, data: () => stored }),
  };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (work: (tx: any) => Promise<unknown>) => work({
      get: async () => ({ exists: Object.keys(stored).length > 0, data: () => stored }),
      set: (_ref: unknown, value: Record<string, unknown>) => { stored = value; },
    }),
  };
  return db;
}

afterEach(() => setServerDb(null));

describe('App Mart admin pins', () => {
  it('keeps one ordered list shared by APK and Web Apps', async () => {
    setServerDb(fakeDb() as never);
    await setAppMartPin('web', 'web-a', true);
    await setAppMartPin('apk', 'apk-a', true);
    await setAppMartPin('web', 'web-b', true);
    expect((await getAppMartPins()).map((p) => `${p.kind}:${p.id}`)).toEqual([
      'web:web-a', 'apk:apk-a', 'web:web-b',
    ]);
  });

  it('enforces six slots across both app types and frees a slot on unpin', async () => {
    setServerDb(fakeDb() as never);
    for (let i = 0; i < APP_MART_PIN_LIMIT; i++) {
      await setAppMartPin(i % 2 ? 'web' : 'apk', `app-${i}`, true);
    }
    await expect(setAppMartPin('web', 'seventh', true)).rejects.toThrow('APP_MART_PIN_LIMIT_REACHED');
    await setAppMartPin('apk', 'app-2', false);
    await setAppMartPin('web', 'seventh', true);
    expect(await getAppMartPins()).toHaveLength(APP_MART_PIN_LIMIT);
    expect((await getAppMartPins()).at(-1)?.id).toBe('seventh');
  });

  it('does not duplicate a pin when the same action is repeated', async () => {
    setServerDb(fakeDb() as never);
    await setAppMartPin('apk', 'same-app', true);
    await setAppMartPin('apk', 'same-app', true);
    expect(await getAppMartPins()).toHaveLength(1);
  });
});
