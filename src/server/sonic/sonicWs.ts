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
//                      { type: 'billing', seconds, inr }     // live meter (see voiceBilling.ts)
//                      { type: 'ended', reason }             // 'no_balance' | 'max_duration'
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
import {
  VOICE_TICK_MS, VOICE_MAX_CALL_SECONDS, unbilledSeconds, voiceSecondsCostInr,
  shouldEndCallForBalance, mayStartVoiceCall, voiceDebitRef, voiceChargeDescription,
} from './voiceBilling';
import { debitWalletForBuild } from '../lib/walletDebit';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { getServerDb } from '../lib/serverDb';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';

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

  // ── THE METER (admin 2026-08-10: voice is a paid service) ────────────────────────────────────
  // Billing starts at `ready` — everything before it is us getting our own session up, and a user who
  // got nothing is never charged. From there the call settles every VOICE_TICK_MS so the balance moves
  // while the user can still see it, an abandoned call is cut off instead of running up a bill, and a
  // dropped socket loses at most one tick. The decisions live in voiceBilling.ts; this is the plumbing.
  const callId = `${uid || 'anon'}_${Date.now().toString(36)}`;
  const freeListed = isAgentV3FreeUser(uid, null);
  let billingStartedAt = 0;
  /** When the call stopped being billable. 0 = still live. See settle() for why this exists. */
  let billingEndedAt = 0;
  let billedSeconds = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let ending = false;

  /**
   * Charge everything owed so far. Returns the seconds settled by THIS call. Never throws.
   *
   * The billing clock STOPS at `billingEndedAt`. Without it, the seconds between a call ending and
   * the socket's 'close' event finally arriving would be billed as talking time — the user charged
   * for a call that was already over. Small, but it is the difference between a bill you can explain
   * and one you cannot.
   */
  const settle = async (): Promise<number> => {
    if (!billingStartedAt || !uid || freeListed) return 0;
    const owed = unbilledSeconds(billingStartedAt, billingEndedAt || Date.now(), billedSeconds);
    if (owed <= 0) return 0;
    const through = billedSeconds + owed;
    // Counted as billed BEFORE the await: a second tick firing mid-write must not re-charge the same
    // seconds. A failed write therefore forgives that slice rather than risking a double debit — the
    // safe direction when the alternative lands on a real person's balance.
    billedSeconds = through;
    try {
      await debitWalletForBuild(getServerDb() as any, uid, {
        billedInr: voiceSecondsCostInr(owed),
        buildRef: voiceDebitRef(callId, through),
        description: voiceChargeDescription(owed),
      });
    } catch { /* the call must never break over a money write */ }
    return owed;
  };

  /** End the call for a real, nameable reason — and tell the user which, before the socket closes. */
  const endCall = (reason: 'no_balance' | 'max_duration') => {
    if (ending) return;
    ending = true;
    billingEndedAt = Date.now(); // the clock stops the moment the call does, not when 'close' lands
    // THE TICKER IS STOPPED HERE, NOT LEFT TO ws.on('close') — this is the bug that made the fix
    // worth writing. `ws.close()` on a socket that is already gone emits no 'close' event, so the
    // interval would have kept running on a dead call and every later tick would have billed more
    // elapsed seconds. Worst of all it would have hit the exact user this branch exists for: the one
    // whose balance just ran out, charged on for a call that had already ended.
    if (ticker) { clearInterval(ticker); ticker = null; }
    send(ws, { type: 'ended', reason });
    void settle().finally(() => { try { ws.close(); } catch { /* already closed */ } });
  };

  const startMeter = () => {
    if (billingStartedAt || !uid || freeListed) return;
    billingStartedAt = Date.now();
    ticker = setInterval(() => {
      void (async () => {
        // A tick that was already in flight when the call ended must not charge past it — the awaits
        // below mean one can still be mid-run after endCall() cleared the interval.
        if (ending) return;
        const seconds = billedSeconds + unbilledSeconds(billingStartedAt, Date.now(), billedSeconds);
        if (seconds >= VOICE_MAX_CALL_SECONDS) { endCall('max_duration'); return; }
        await settle();
        if (ending) return;
        // The live meter the user watches — the same numbers the wallet just moved by, so the screen
        // and the balance can never tell different stories.
        send(ws, { type: 'billing', seconds: billedSeconds, inr: voiceSecondsCostInr(billedSeconds) });
        // Out of money mid-call ⇒ END it. Letting it run into an overdraft would be discovered later
        // as a number the user cannot explain; ending it now can be explained while they are listening.
        const balance = await readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid)
          .catch(() => null);
        if (shouldEndCallForBalance(balance)) endCall('no_balance');
      })();
    }, VOICE_TICK_MS);
  };

  const stopMeter = () => {
    if (ticker) { clearInterval(ticker); ticker = null; }
    // A normal hang-up stops the clock here; a call ended by endCall() already stopped it, and that
    // earlier timestamp wins so the gap before 'close' arrives is never billed.
    if (!billingEndedAt) billingEndedAt = Date.now();
    void settle(); // the final, partial slice — a hang-up must not be a free slice of call
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
      // The meter starts HERE and nowhere else: `ready` is the first moment the user is actually
      // talking to something. A start that throws bills nothing at all.
      .then(() => { startMeter(); send(ws, { type: 'ready' }); })
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

  ws.on('close', () => { stopMeter(); persistMemory(); session?.close(); });
  ws.on('error', () => { stopMeter(); persistMemory(); session?.close(); });
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
    .then(async (uid) => {
      if (!uid) { socket.destroy(); return; } // logged-in users only
      // EMPTY WALLET ⇒ REFUSED BEFORE THE PROVIDER IS DIALLED (admin 2026-08-10). Same rule the chat
      // turns follow: unlike a build, a live call has no later pre-flight to catch an overdraft, so
      // the check has to happen here. An UNREADABLE balance is allowed through — fail-open, exactly
      // like the build and chat gates, because denying a paying user their call over a Firestore blip
      // is the worse error and the meter still records the debt honestly.
      if (!isAgentV3FreeUser(uid, null)) {
        const balance = await readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid)
          .catch(() => null);
        if (!mayStartVoiceCall(balance, false)) { socket.destroy(); return; }
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, uid));
    })
    .catch(() => socket.destroy());
  return true;
}
