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
import { parseBoli, type SonicBoli } from './sonicBoli';
import { mergeSeed } from './voiceMemory';
import { voiceMemoryStore } from './VoiceMemoryStore';
import { isSonicEnabled } from './featureFlag';
import { sonicPersonaFor } from './sonicPersona';
import { verifyIdentityWithReason, adminAppOptions } from '../lib/authMiddleware';
import { loadFirebaseAdmin } from '../lib/firebaseAdminModule';

export const SONIC_WS_PATH = '/api/sonic/stream';

/**
 * Verify the Firebase ID token passed as the `token` query param and return the caller's uid (or
 * null). Sonic Chat is LOGGED-IN USERS ONLY (admin 2026-07-13) — Nova Sonic is paid, so an
 * anonymous caller must never open a stream. The uid also keys the user's cross-session voice
 * memory. Reuses the tested verify path (with its cold-start retry). Under VITEST there is no admin
 * SDK, so it resolves to null and the gate refuses (safe default).
 */
async function verifySonicUser(token: string | null): Promise<string | null> {
  if (!token) return null;
  const res = await verifyIdentityWithReason(`Bearer ${token}`, async () => {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp(adminAppOptions());
    return admin.auth();
  });
  return res.identity?.uid ?? null;
}

const wss = new WebSocketServer({ noServer: true });

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage, uid?: string) => {
  // The chosen voice (male → matthew, female → tiffany) and regional boli (tone flavour) ride the
  // WS query; defaults: female voice, neutral boli. parseBoli validates the untrusted boli value.
  const params = new URLSearchParams((req.url || '').split('?')[1] || '');
  const voice: SonicVoice = params.get('voice') === 'male' ? 'male' : 'female';
  const boli: SonicBoli = parseBoli(params.get('boli'));

  // The session is created on the client's FIRST message (`init`), which carries the persona
  // (a professional's own prompt) and the prior text conversation to continue. This lets the
  // Doctor voice BE the doctor and resume a text chat from where it left off. The client always
  // sends init before any audio, so ordering guarantees the session exists first.
  let session: SonicSession | null = null;

  // Cross-session "co-founder memory" (admin 2026-07-14): every spoken turn this session is buffered
  // so it can be folded into the user's persistent memory when the call ends — keyed per user +
  // professional. Best-effort: with no uid (should not happen post-verify) memory is simply skipped.
  let professionalId: string | undefined;
  const transcript: SonicTurn[] = [];
  let persisted = false;

  const persistMemory = () => {
    if (persisted || !uid || transcript.length === 0) return;
    persisted = true;
    void voiceMemoryStore.append(uid, professionalId, transcript.slice());
  };

  const startSession = (persona?: string, history?: SonicTurn[]) => {
    if (session) return;
    session = new SonicSession({
      onAudioOutput: (b64) => send(ws, { type: 'audio', data: b64 }),
      onText: (text, role) => {
        send(ws, { type: 'text', text, role });
        const t = (text || '').trim();
        if (t) transcript.push({ role: role === 'USER' ? 'user' : 'assistant', content: t });
      },
      onTurnComplete: () => send(ws, { type: 'turn_complete' }),
      onInterrupted: () => send(ws, { type: 'interrupted' }),
      onError: (message) => send(ws, { type: 'error', message }),
      onClose: () => { persistMemory(); try { ws.close(); } catch { /* already closed */ } },
    }, { voice, persona, history, boli });
    session.start()
      .then(() => send(ws, { type: 'ready' }))
      .catch((e) => send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: string; professionalId?: string; history?: SonicTurn[] };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'init') {
      professionalId = typeof msg.professionalId === 'string' ? msg.professionalId : undefined;
      // Server-side persona lookup — the client only names WHICH professional; a raw prompt is never
      // trusted from the client (prompt-injection guard). Resolves the config-driven professionals AND
      // the bespoke Doctor AI (SDA) clinical voice persona. Unknown/absent id → default voice.
      const persona = sonicPersonaFor(professionalId);
      const clientHistory = Array.isArray(msg.history) ? msg.history : [];
      // Load this user's remembered turns for this professional and seed them BEFORE the live text
      // chat, so voice continues across calls (not just within the current text thread). Best-effort
      // and bounded (mergeSeed dedups + caps); a load failure just means no persisted memory.
      voiceMemoryStore.load(uid || '', professionalId)
        .then((remembered) => startSession(persona, mergeSeed(remembered, clientHistory)))
        .catch(() => startSession(persona, mergeSeed([], clientHistory)));
    } else if (msg.type === 'audio' && typeof msg.data === 'string') { if (!session) startSession(); session?.sendAudio(msg.data); }
    else if (msg.type === 'stop') session?.close();
  });

  ws.on('close', () => { persistMemory(); session?.close(); });
  ws.on('error', () => { persistMemory(); session?.close(); });
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
    .then((uid) => {
      if (!uid) { socket.destroy(); return; } // logged-in users only
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, uid));
    })
    .catch(() => socket.destroy());
  return true;
}
