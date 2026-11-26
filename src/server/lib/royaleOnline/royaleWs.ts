// ONLINE ROYALE — THE WEBSOCKET DOOR (admin 2026-11-25).
//
// Wire protocol (JSON text frames, at most MAX_FRAME_BYTES each):
//   client → server: { t:'queue' } · { t:'leave' } · { t:'move', x, z, yaw, seq } · { t:'fire', yaw } · { t:'ping', id }
//   server → client: { t:'welcome', token, you, resumed } · { t:'queued', waiting, busy } · { t:'start', … }
//                    { t:'state', … } · { t:'correct', x, z, reason } · { t:'shot', hit } · { t:'end', … }
//                    { t:'unavailable', reason } · { t:'full', reason } · { t:'pong', id }
//
// WHO MAY CONNECT: players of a game PUBLISHED on NavBharatAI's App Store. Players are anonymous (they have no
// NavBharatAI account inside the store's sandboxed player), so the identity is a SIGNED PER-SESSION TOKEN minted
// on connect (matchService.ts) and presented again to resume within the grace window. A private app's players must
// carry the same short-lived capability NavData demands (navDataAccess.ts) — knowing the app id is not enough.
//
// KILL SWITCH: AGENTV3_ONLINE_MATCH (docs/claude/ENV_REGISTRY.md). Default OFF. Off ⇒ the socket is accepted only to
// say so honestly and is closed; no room, no queue, no tick.

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { envFlag } from '../envFlag';
import { addressRateKey } from '../clientAddress';
import { RoyaleMatchService, type Conn } from './matchService';

export const ROYALE_WS_PATH = '/api/royale-online/ws';
export const MAX_FRAME_BYTES = 512;
/** Per address: open sockets, and new sockets per minute. Generous, because a mobile carrier puts many phones behind one address. */
export const MAX_SOCKETS_PER_ADDRESS = 12;
export const MAX_CONNECTS_PER_ADDRESS_PER_MIN = 60;
export const HEARTBEAT_MS = 20_000;

export function onlineMatchEnabled(): boolean { return envFlag('AGENTV3_ONLINE_MATCH', false); }

export type AppVerdict = 'ok' | 'missing' | 'private' | 'unavailable';
export type VerifyApp = (appId: string, access: string | null) => Promise<AppVerdict>;
const APP_ID = /^[A-Za-z0-9_-]{1,64}$/;

const REASONS: Record<Exclude<AppVerdict, 'ok'>, string> = {
  missing: 'Online matches work for games published on the NavBharatAI App Store. This game is not on the store.',
  private: 'This game is private. Reopen it and enter its password to play online.',
  unavailable: 'The online match service could not check this game right now. Try again in a minute, or play Practice.',
};

export type RoyaleUpgradeOptions = {
  service: RoyaleMatchService;
  verifyApp: VerifyApp;
  enabled?: () => boolean;
  addressKey?: (req: IncomingMessage) => string;
  now?: () => number;
};

/** Build the upgrade handler. Returns true when it OWNS the request (its path), false otherwise. */
export function createRoyaleUpgradeHandler(opts: RoyaleUpgradeOptions) {
  const enabled = opts.enabled ?? onlineMatchEnabled;
  const now = opts.now ?? Date.now;
  const keyOf = opts.addressKey ?? ((req: IncomingMessage) => addressRateKey(req as never));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES * 2 });
  const open = new Map<string, number>();
  const recent = new Map<string, number[]>();

  const refuseRaw = (socket: Duplex, status: string) => {
    try { socket.write('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* gone */ }
    socket.destroy();
  };
  const sayAndClose = (ws: WebSocket, msg: Record<string, unknown>, code: number) => {
    try { ws.send(JSON.stringify(msg)); } catch { /* gone */ }
    ws.close(code, String(msg.t));
  };

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const live = ws as WebSocket & { isAlive?: boolean };
      if (live.isAlive === false) { ws.terminate(); continue; }
      live.isAlive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function handle(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const [path, query] = (req.url || '').split('?');
    if (path !== ROYALE_WS_PATH) return false;
    const key = keyOf(req);
    const t = now();
    const times = (recent.get(key) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= MAX_CONNECTS_PER_ADDRESS_PER_MIN || (open.get(key) ?? 0) >= MAX_SOCKETS_PER_ADDRESS) {
      refuseRaw(socket, '429 Too Many Requests');
      return true;
    }
    times.push(t); recent.set(key, times);
    if (recent.size > 10_000) recent.clear(); // bounded memory under an address flood

    const params = new URLSearchParams(query || '');
    const appId = params.get('app') || '';
    const access = params.get('access');
    const resume = params.get('resume');

    const accept = (after: (ws: WebSocket) => void) => wss.handleUpgrade(req, socket, head, (ws) => {
      open.set(key, (open.get(key) ?? 0) + 1);
      ws.on('close', () => { const n = (open.get(key) ?? 1) - 1; if (n <= 0) open.delete(key); else open.set(key, n); });
      after(ws);
    });

    if (!enabled()) {
      accept((ws) => sayAndClose(ws, { t: 'unavailable', reason: 'Online matches are switched off right now. Practice still works.' }, 4403));
      return true;
    }
    if (!APP_ID.test(appId)) {
      accept((ws) => sayAndClose(ws, { t: 'unavailable', reason: REASONS.missing }, 4404));
      return true;
    }
    opts.verifyApp(appId, access)
      .catch((): AppVerdict => 'unavailable')
      .then((verdict) => accept((ws) => {
        if (verdict !== 'ok') { sayAndClose(ws, { t: 'unavailable', reason: REASONS[verdict] }, verdict === 'private' ? 4401 : 4404); return; }
        const conn: Conn = {
          send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
          close: (code, reason) => { try { ws.close(code, reason); } catch { /* closed */ } },
        };
        const playerId = opts.service.connect(appId, conn, resume);
        if (!playerId) return;
        (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
        ws.on('pong', () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const text = data.toString();
          if (text.length > MAX_FRAME_BYTES) return;
          let msg: unknown;
          try { msg = JSON.parse(text); } catch { return; }
          opts.service.message(playerId, msg);
        });
        ws.on('close', () => opts.service.disconnect(playerId, conn));
        ws.on('error', () => { /* 'close' follows */ });
      }))
      .catch(() => socket.destroy());
    return true;
  }
  return Object.assign(handle, { close: () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); } });
}

// ── the production instance ─────────────────────────────────────────────────────────────────────────────────
let prod: ReturnType<typeof createRoyaleUpgradeHandler> | null = null;

/** The live store check: the app exists, is not taken down, and (if private) the caller carries a valid capability. */
async function verifyStoreApp(appId: string, access: string | null): Promise<AppVerdict> {
  const [{ getWebApp }, { canAccessNavData }] = await Promise.all([import('../navStoreWeb'), import('../navDataAccess')]);
  const found = await getWebApp(appId);
  if (!found || found.status === 'removed') return 'missing';
  return canAccessNavData(found, access) ? 'ok' : 'private';
}

export const royaleMatchService = new RoyaleMatchService();

export function handleRoyaleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  if ((req.url || '').split('?')[0] !== ROYALE_WS_PATH) return false;
  prod ??= createRoyaleUpgradeHandler({ service: royaleMatchService, verifyApp: verifyStoreApp });
  return prod(req, socket, head);
}
