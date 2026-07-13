// Sonic Chat WebSocket bridge — connects a browser mic/speaker to a Nova Sonic session.
//
// Wire protocol (JSON text frames):
//   browser → server:  { type: 'audio', data: <base64 LPCM 16kHz mono> }
//                      { type: 'stop' }                      // user ended the turn/session
//   server → browser:  { type: 'ready' }
//                      { type: 'audio', data: <base64 LPCM 24kHz mono> }   // play this
//                      { type: 'text',  text, role }
//                      { type: 'turn_complete' }
//                      { type: 'error', message }
//
// Isolated + gated: handleSonicUpgrade refuses the upgrade unless isSonicEnabled() (flag +
// AWS creds). Returns true when it OWNS the upgrade (so the caller stops), false otherwise.

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { SonicSession } from './SonicBridge';
import { isSonicEnabled } from './featureFlag';

export const SONIC_WS_PATH = '/api/sonic/stream';

const wss = new WebSocketServer({ noServer: true });

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket) => {
  const session = new SonicSession({
    onAudioOutput: (b64) => send(ws, { type: 'audio', data: b64 }),
    onText: (text, role) => send(ws, { type: 'text', text, role }),
    onTurnComplete: () => send(ws, { type: 'turn_complete' }),
    onError: (message) => send(ws, { type: 'error', message }),
    onClose: () => { try { ws.close(); } catch { /* already closed */ } },
  });

  session.start()
    .then(() => send(ws, { type: 'ready' }))
    .catch((e) => send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) }));

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: string };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'audio' && typeof msg.data === 'string') session.sendAudio(msg.data);
    else if (msg.type === 'stop') session.close();
  });

  ws.on('close', () => session.close());
  ws.on('error', () => session.close());
});

/**
 * Handle a raw HTTP upgrade for the Sonic WS path. Returns true when this handler owns the
 * upgrade (matched the path) — the caller must then stop. Refuses (and destroys) the socket
 * when the feature is disabled, so a stray connection can never open a paid Bedrock stream.
 */
export function handleSonicUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const path = (req.url || '').split('?')[0];
  if (path !== SONIC_WS_PATH) return false;
  if (!isSonicEnabled()) { socket.destroy(); return true; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  return true;
}
