import { describe, it, expect } from 'vitest';
import { generateRealtimeIntegration, isRealtimeProvider } from './RealtimeGenerator';

describe('generateRealtimeIntegration — Pusher', () => {
  const c = generateRealtimeIntegration('pusher');

  it('server publish() uses the Pusher SDK with the server secret', () => {
    const server = c.files['src/server/realtime.ts'];
    expect(server).toContain("import Pusher from 'pusher'");
    expect(server).toContain('pusher.trigger');
    expect(server).toContain('PUSHER_SECRET');
    expect(server).toContain('export async function publish');
  });

  it('client subscribe() returns an UNSUBSCRIBE cleanup (good React pattern)', () => {
    const client = c.files['src/lib/realtime.ts'];
    expect(client).toContain("import Pusher from 'pusher-js'");
    expect(client).toContain('export function subscribe');
    expect(client).toContain('return () =>');           // returns a cleanup
    expect(client).toContain('pusher.unsubscribe');
    expect(client).toContain('VITE_PUSHER_KEY');         // browser uses the public key, not the secret
  });

  it('declares both pusher deps + server-and-browser env keys', () => {
    expect(c.dependencies.map((d) => d.name)).toEqual(['pusher', 'pusher-js']);
    for (const k of ['PUSHER_SECRET', 'VITE_PUSHER_KEY']) expect(c.envKeys).toContain(k);
  });
});

describe('generateRealtimeIntegration — Ably', () => {
  const c = generateRealtimeIntegration('ably');

  it('server publish() + client subscribe() with a cleanup, single ably dep', () => {
    expect(c.files['src/server/realtime.ts']).toContain('ably.channels.get');
    expect(c.files['src/lib/realtime.ts']).toContain('ch.unsubscribe');
    expect(c.files['src/lib/realtime.ts']).toContain('return () =>');
    expect(c.dependencies).toEqual([{ name: 'ably', version: '^2' }]);
  });
});

describe('safety + guards', () => {
  it('never bakes a secret into .env.example and has no TODO/stub placeholders', () => {
    for (const p of ['pusher', 'ably'] as const) {
      const cfg = generateRealtimeIntegration(p);
      for (const k of cfg.envKeys) expect(cfg.files['.env.example']).toContain(`${k}=`);
      expect(cfg.files['src/server/realtime.ts']).not.toMatch(/TODO|FIXME|not implemented|your-code-here/i);
    }
  });

  it('isRealtimeProvider guards; unknown → throws', () => {
    expect(isRealtimeProvider('pusher')).toBe(true);
    expect(isRealtimeProvider('ably')).toBe(true);
    for (const v of ['socketio', '', null]) expect(isRealtimeProvider(v)).toBe(false);
    // @ts-expect-error invalid
    expect(() => generateRealtimeIntegration('socketio')).toThrow();
  });
});
