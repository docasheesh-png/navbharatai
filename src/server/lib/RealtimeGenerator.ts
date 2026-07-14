// U-4 (verified recipe modules) — realtime pub/sub generator (Pusher + Ably).
//
// Live features — chat, notifications, presence, collaborative updates — need a realtime channel. This emits
// a real server-side publish() helper (the secret stays server-side) and a client subscribe() that returns an
// UNSUBSCRIBE cleanup (the correct React pattern — call it in a useEffect cleanup so it never leaks). Bring-
// Your-Own keys (pasted into .env; NavBharatAI never stores them). PURE builders; complete correct code (no
// TODO stubs — the real-features rule). Unit-tested.

export type RealtimeProvider = 'pusher' | 'ably';

export interface RealtimeConfig {
  provider: RealtimeProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const PUSHER_SERVER = `import Pusher from 'pusher';

// Bring-Your-Own Pusher credentials — from the Pusher Channels dashboard, pasted into .env (secret stays server-side).
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID as string,
  key: process.env.PUSHER_KEY as string,
  secret: process.env.PUSHER_SECRET as string,
  cluster: process.env.PUSHER_CLUSTER as string,
  useTLS: true,
});

// Publish an event to a channel from the server. Call this from your routes (e.g. after saving a message).
export async function publish(channel: string, event: string, data: unknown): Promise<void> {
  await pusher.trigger(channel, event, data);
}
`;

const PUSHER_CLIENT = `import Pusher from 'pusher-js';

// The public key + cluster are safe in the browser (the SECRET never is). Set them as VITE_ vars.
const pusher = new Pusher(import.meta.env.VITE_PUSHER_KEY as string, {
  cluster: import.meta.env.VITE_PUSHER_CLUSTER as string,
});

// Subscribe to an event on a channel. Returns an UNSUBSCRIBE function — call it in a useEffect cleanup:
//   useEffect(() => subscribe('chat', 'message', onMsg), []);
export function subscribe(channel: string, event: string, onEvent: (data: unknown) => void): () => void {
  const ch = pusher.subscribe(channel);
  ch.bind(event, onEvent);
  return () => { ch.unbind(event, onEvent); pusher.unsubscribe(channel); };
}
`;

const ABLY_SERVER = `import Ably from 'ably';

// Bring-Your-Own Ably key — from the Ably dashboard, pasted into .env (server-side only).
const ably = new Ably.Rest(process.env.ABLY_API_KEY as string);

// Publish an event to a channel from the server.
export async function publish(channel: string, event: string, data: unknown): Promise<void> {
  await ably.channels.get(channel).publish(event, data);
}
`;

const ABLY_CLIENT = `import Ably from 'ably';

// Use a token-authed client in production; the public key below is fine for getting started (set it as a VITE_ var).
const ably = new Ably.Realtime(import.meta.env.VITE_ABLY_KEY as string);

// Subscribe to an event on a channel. Returns an UNSUBSCRIBE function — call it in a useEffect cleanup.
export function subscribe(channel: string, event: string, onEvent: (data: unknown) => void): () => void {
  const ch = ably.channels.get(channel);
  const handler = (msg: { data: unknown }) => onEvent(msg.data);
  ch.subscribe(event, handler);
  return () => ch.unsubscribe(event, handler);
}
`;

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

/** Generate a working BYO realtime integration for a provider. Deterministic; unknown provider → throws. */
export function generateRealtimeIntegration(provider: RealtimeProvider): RealtimeConfig {
  switch (provider) {
    case 'pusher':
      return {
        provider,
        dependencies: [{ name: 'pusher', version: '^5' }, { name: 'pusher-js', version: '^8' }],
        envKeys: ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER', 'VITE_PUSHER_KEY', 'VITE_PUSHER_CLUSTER'],
        files: {
          'src/server/realtime.ts': PUSHER_SERVER,
          'src/lib/realtime.ts': PUSHER_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['PUSHER_APP_ID', 'Pusher app id (server-side)'],
            ['PUSHER_KEY', 'Pusher key (server-side)'],
            ['PUSHER_SECRET', 'Pusher secret (server-side ONLY)'],
            ['PUSHER_CLUSTER', 'Pusher cluster, e.g. ap2'],
            ['VITE_PUSHER_KEY', 'Pusher key for the browser (same as PUSHER_KEY — safe to expose)'],
            ['VITE_PUSHER_CLUSTER', 'Pusher cluster for the browser'],
          ]),
        },
        instructions: 'On the server call publish(channel, event, data) after a state change. On the client call subscribe(channel, event, cb) inside a useEffect and RETURN its result as the cleanup so it unsubscribes on unmount. Your secret stays server-side; NavBharatAI never stores your keys.',
      };
    case 'ably':
      return {
        provider,
        dependencies: [{ name: 'ably', version: '^2' }],
        envKeys: ['ABLY_API_KEY', 'VITE_ABLY_KEY'],
        files: {
          'src/server/realtime.ts': ABLY_SERVER,
          'src/lib/realtime.ts': ABLY_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['ABLY_API_KEY', 'Ably API key (server-side)'],
            ['VITE_ABLY_KEY', 'Ably key for the browser — use a token-authed client in production'],
          ]),
        },
        instructions: 'On the server call publish(channel, event, data). On the client call subscribe(channel, event, cb) inside a useEffect and RETURN its result as the cleanup. For production, switch the browser client to token auth instead of a raw key. Your key stays in YOUR env.',
      };
    default:
      throw new Error(`Unknown realtime provider: ${provider}`);
  }
}

/** Valid-provider guard for the tool layer. */
export function isRealtimeProvider(v: unknown): v is RealtimeProvider {
  return v === 'pusher' || v === 'ably';
}
