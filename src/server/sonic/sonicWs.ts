// Sonic Chat WebSocket bridge — connects a browser mic/speaker to a Nova Sonic session.
//
// Wire protocol (JSON text frames):
//   browser → server:  { type: 'audio', data: <base64 LPCM 16kHz mono> }
//                      { type: 'stop' }                      // user ended the turn/session
//   server → browser:  { type: 'ready' }
//                      { type: 'audio', data: <base64 LPCM 24kHz mono> }   // play this
//                      { type: 'text',  text, role }
//                      { type: 'turn_complete' }
//                      { type: 'interrupted' }               // user barged in — flush playback
//                      { type: 'error', message }
//
// Isolated + gated: handleSonicUpgrade refuses the upgrade unless isSonicEnabled() (flag +
// AWS creds). Returns true when it OWNS the upgrade (so the caller stops), false otherwise.

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { SonicSession, type SonicVoice, type SonicTurn } from './SonicBridge';
import { isSonicEnabled } from './featureFlag';
import { getProfessional } from '../professionals/registry';
import { buildProfessionalSystemPrompt } from '../professionals/engine';
import { verifyIdentityWithReason, adminAppOptions } from '../lib/authMiddleware';
import { loadFirebaseAdmin } from '../lib/firebaseAdminModule';

export const SONIC_WS_PATH = '/api/sonic/stream';

/**
 * Verify the Firebase ID token passed as the `token` query param. Sonic Chat is LOGGED-IN
 * USERS ONLY (admin 2026-07-13) — Nova Sonic is paid, so an anonymous caller must never be
 * able to open a stream. Reuses the tested verify path (with its cold-start retry). Under
 * VITEST there is no admin SDK, so it resolves to null and the gate refuses (safe default).
 */
async function verifySonicUser(token: string | null): Promise<boolean> {
  if (!token) return false;
  const res = await verifyIdentityWithReason(`Bearer ${token}`, async () => {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp(adminAppOptions());
    return admin.auth();
  });
  return !!res.identity;
}

const wss = new WebSocketServer({ noServer: true });

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // The chosen voice (male → matthew, female → tiffany) rides the WS query; default female.
  const voiceParam = new URLSearchParams((req.url || '').split('?')[1] || '').get('voice');
  const voice: SonicVoice = voiceParam === 'male' ? 'male' : 'female';

  // The session is created on the client's FIRST message (`init`), which carries the persona
  // (a professional's own prompt) and the prior text conversation to continue. This lets the
  // Doctor voice BE the doctor and resume a text chat from where it left off. The client always
  // sends init before any audio, so ordering guarantees the session exists first.
  let session: SonicSession | null = null;

  const startSession = (persona?: string, history?: SonicTurn[]) => {
    if (session) return;
    session = new SonicSession({
      onAudioOutput: (b64) => send(ws, { type: 'audio', data: b64 }),
      onText: (text, role) => send(ws, { type: 'text', text, role }),
      onTurnComplete: () => send(ws, { type: 'turn_complete' }),
      onInterrupted: () => send(ws, { type: 'interrupted' }),
      onError: (message) => send(ws, { type: 'error', message }),
      onClose: () => { try { ws.close(); } catch { /* already closed */ } },
    }, { voice, persona, history });
    session.start()
      .then(() => send(ws, { type: 'ready' }))
      .catch((e) => send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: string; professionalId?: string; history?: SonicTurn[] };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'init') {
      // Server-side persona lookup — the client only names WHICH professional; a raw prompt is
      // never trusted from the client (prompt-injection guard). Unknown/absent id → default voice.
      const cfg = typeof msg.professionalId === 'string' ? getProfessional(msg.professionalId) : undefined;
      const persona = cfg ? buildProfessionalSystemPrompt(cfg) : undefined;
      startSession(persona, Array.isArray(msg.history) ? msg.history : undefined);
    } else if (msg.type === 'audio' && typeof msg.data === 'string') { if (!session) startSession(); session?.sendAudio(msg.data); }
    else if (msg.type === 'stop') session?.close();
  });

  ws.on('close', () => session?.close());
  ws.on('error', () => session?.close());
});

/**
 * Handle a raw HTTP upgrade for the Sonic WS path. Returns true when this handler owns the
 * upgrade (matched the path) — the caller must then stop. Refuses (and destroys) the socket
 * when the feature is disabled OR the caller is not a verified signed-in user, so a stray or
 * anonymous connection can never open a paid Bedrock stream. Verification is async; the
 * return value just says "I own this path" — the accept/reject happens on the promise.
 */
export function handleSonicUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const [path, query] = (req.url || '').split('?');
  if (path !== SONIC_WS_PATH) return false;
  if (!isSonicEnabled()) { socket.destroy(); return true; }
  const token = new URLSearchParams(query || '').get('token');
  verifySonicUser(token)
    .then((ok) => {
      if (!ok) { socket.destroy(); return; } // logged-in users only
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    })
    .catch(() => socket.destroy());
  return true;
}
