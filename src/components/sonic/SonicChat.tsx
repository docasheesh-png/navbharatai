// NavBharatAI Voice — a COMPACT, bottom-docked voice widget (admin 2026-07-14: not a full-screen
// takeover). Portaled to <body> so it escapes any CSS-transformed ancestor and docks correctly.
//
// Self-contained: it probes /api/sonic/status and renders nothing but an honest "not available" note
// unless the server says voice is enabled. When live it captures the mic as 16 kHz PCM, streams it over
// the Voice WebSocket, and plays back the 24 kHz PCM the model returns. A live audio-reactive WAVEFORM
// (equaliser bars) reacts to REAL audio levels — the mic (you speaking) and the playback (the assistant
// speaking) — so the "listening / speaking" motion is never faked. NO underlying provider/model name is
// ever shown: to the user this is NavBharatAI Voice.
//
// Delete this folder + the server sonic/ folder to remove the feature entirely. The real voice
// round-trip is only verifiable in a browser on a deploy; the PCM math is unit-tested in sonicAudio.test.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downsampleFloat32, float32ToBase64PCM16, base64PCM16ToFloat32 } from './sonicAudio';
import { BOLI_OPTIONS, type SonicBoli } from '../../server/sonic/sonicBoli';
import { auth } from '../../lib/firebase';
import { voiceRunningCostLabel, resolveVoiceLang } from '../../lib/voiceChatBilling';
import { resolveWebSocketUrl, isNativeShell } from '../../lib/apiBase';
import { requestMic, micMessage, micSupported } from '../../lib/micCapability';

type Status = 'loading' | 'disabled' | 'idle' | 'connecting' | 'live' | 'error';
interface Line { role: string; text: string }

const MIC_RATE = 16000;
const OUT_RATE = 24000;

export interface SonicTurn { role: 'user' | 'assistant'; content: string }

export function SonicChat({ onClose, professionalId, history }: { onClose?: () => void; professionalId?: string; history?: SonicTurn[] } = {}) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  /**
   * Seconds the SERVER has actually billed. Voice is charged per second (admin 2026-08-10), and the
   * meter must show what the wallet really moved by — a locally-counted stopwatch would drift and end
   * up displaying a different figure from the one charged, which is the kind of small discrepancy
   * that destroys trust in a bill. `null` = the server has not reported a tick yet, so nothing shows.
   */
  const [billedSeconds, setBilledSeconds] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false); // assistant is talking (from real playback level)
  const [showTranscript, setShowTranscript] = useState(false);
  const [voice, setVoice] = useState<'male' | 'female'>('female'); // chosen before a call starts
  const [boli, setBoli] = useState<SonicBoli>('neutral'); // regional tone flavour, chosen before a call
  const [muted, setMuted] = useState(false); // mic muted mid-call — mic audio stops leaving the device

  const wsRef = useRef<WebSocket | null>(null);
  /** Whether this runtime can record at all. Read once — it cannot change while the screen is open. */
  const [micAvailable] = useState(micSupported);
  const micCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playAnalyserRef = useRef<AnalyserNode | null>(null);   // REAL spectrum of the ASSISTANT's voice
  const micAnalyserRef = useRef<AnalyserNode | null>(null);    // REAL spectrum of YOUR voice
  const nextPlayRef = useRef(0);
  const mutedRef = useRef(false);                              // read in the audio callback (no re-bind)
  const playSourcesRef = useRef<AudioBufferSourceNode[]>([]);  // live scheduled buffers, for barge-in flush

  // Audio-reactive waveform: each bar's height is a REAL frequency-bin amplitude — from your mic while
  // you speak, from the assistant's playback while it speaks. No scripted motion; silence → flat bars.
  const barsRef = useRef<Array<HTMLDivElement | null>>([]);
  const rafRef = useRef<number | null>(null);

  const NBARS = 9;

  useEffect(() => {
    let alive = true;
    fetch('/api/sonic/status')
      .then((r) => r.json())
      .then((d) => { if (alive) setStatus(d?.enabled ? 'idle' : 'disabled'); })
      .catch(() => { if (alive) setStatus('disabled'); });
    return () => { alive = false; };
  }, []);

  const playChunk = useCallback((b64: string) => {
    let ctx = playCtxRef.current;
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: OUT_RATE });
      playCtxRef.current = ctx;
      nextPlayRef.current = ctx.currentTime;
      // Tap the output through an analyser so the orb reacts to the ASSISTANT's voice in real time.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      playAnalyserRef.current = analyser;
    }
    const float = base64PCM16ToFloat32(b64);
    if (float.length === 0) return;
    const buffer = ctx.createBuffer(1, float.length, OUT_RATE);
    buffer.copyToChannel(float, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(playAnalyserRef.current ?? ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayRef.current);
    src.start(startAt);
    nextPlayRef.current = startAt + buffer.duration;
    // Keep a handle so a barge-in can stop this buffer even after it is scheduled; drop it when done.
    playSourcesRef.current.push(src);
    src.onended = () => { playSourcesRef.current = playSourcesRef.current.filter((s) => s !== src); };
  }, []);

  // Barge-in: the user spoke over the assistant → stop every queued/playing buffer at once and
  // reset the schedule so the next reply starts immediately. This is what makes the assistant
  // actually go quiet the instant you interrupt it (admin 2026-07-14).
  const flushPlayback = useCallback(() => {
    for (const s of playSourcesRef.current) { try { s.onended = null; s.stop(); } catch { /* already ended */ } }
    playSourcesRef.current = [];
    const ctx = playCtxRef.current;
    if (ctx) nextPlayRef.current = ctx.currentTime;
  }, []);

  // The waveform loop (admin 2026-07-14: "real ho to banao!"). EVERY bar's height is a REAL
  // frequency-bin amplitude — read straight from a Web Audio AnalyserNode: your MIC while you speak,
  // the assistant's PLAYBACK while it speaks (whichever is louder wins per bar). Nothing is scripted:
  // no sine wave, no idle animation — when the line is silent the bins are ~0 and the bars sit flat.
  // The "speaking" flag also comes from the real playback energy. Per-bar smoothing only softens the
  // motion; it never invents it.
  useEffect(() => {
    const playFreq = new Uint8Array(128);   // playback analyser fftSize 256 → 128 bins
    const micFreq = new Uint8Array(64);     // mic analyser     fftSize 128 → 64 bins
    const barLevels = new Array(NBARS).fill(0);
    let lastSpeaking = false;
    const tick = () => {
      const pa = playAnalyserRef.current;
      const ma = micAnalyserRef.current;
      if (pa) pa.getByteFrequencyData(playFreq);
      if (ma) ma.getByteFrequencyData(micFreq);
      // Speaking = real energy in the assistant's playback (average of the speech-band bins).
      let playAvg = 0;
      if (pa) { let s = 0; for (let i = 0; i < playFreq.length; i++) s += playFreq[i]; playAvg = s / playFreq.length / 255; }
      const bars = barsRef.current;
      for (let i = 0; i < NBARS; i++) {
        const bar = bars[i];
        if (!bar) continue;
        // Map each bar to a real bin in the speech band of each source, take the louder one.
        const pv = pa ? playFreq[3 + Math.round((i * 40) / (NBARS - 1))] / 255 : 0;
        // Muted → your mic bars read flat (the assistant can't hear you, so show it honestly).
        const mv = (ma && !mutedRef.current) ? micFreq[1 + Math.round((i * 20) / (NBARS - 1))] / 255 : 0;
        const targetLvl = Math.max(pv, mv);
        barLevels[i] += (targetLvl - barLevels[i]) * 0.4;   // soften only — never invent motion
        bar.style.height = `${(5 + barLevels[i] * 44).toFixed(1)}px`;
      }
      const nowSpeaking = playAvg > 0.05;
      if (nowSpeaking !== lastSpeaking) { lastSpeaking = nowSpeaking; setSpeaking(nowSpeaking); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const stop = useCallback(() => {
    try { wsRef.current?.send(JSON.stringify({ type: 'stop' })); } catch { /* closed */ }
    try { wsRef.current?.close(); } catch { /* closed */ }
    wsRef.current = null;
    procRef.current?.disconnect();
    procRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    micAnalyserRef.current = null;
    // Stop any still-scheduled playback and clear mute so a fresh call starts clean.
    for (const s of playSourcesRef.current) { try { s.onended = null; s.stop(); } catch { /* ended */ } }
    playSourcesRef.current = [];
    mutedRef.current = false;
    setMuted(false);
    setStatus((s) => (s === 'error' ? 'error' : 'idle'));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLines([]);
    setStatus('connecting');
    try {
      // Logged-in users only — the server verifies this token before opening a (paid) stream.
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) { setError('Please sign in to use voice.'); setStatus('error'); return; }

      // Ask through the shared helper so a refusal becomes an ACTION the user can take ("allow the
      // Microphone in Settings") instead of one flat "voice failed" for six different causes. On iOS
      // this is also the moment the OS reads NSMicrophoneUsageDescription from Info.plist — without
      // that key the system terminates the app outright rather than showing a prompt.
      const mic = await requestMic();
      if (mic.outcome !== 'ok' || !mic.stream) {
        setError(micMessage(mic.outcome, isNativeShell(window as never)));
        setStatus('error');
        return;
      }
      const stream = mic.stream;
      streamRef.current = stream;
      const micCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      micCtxRef.current = micCtx;
      const source = micCtx.createMediaStreamSource(stream);
      const proc = micCtx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;

      // THE APP BUG (admin report 2026-08-13): this used to build the socket from
      // `window.location.host`, which in the BUNDLED native app is `localhost` — so the phone opened a
      // socket to itself and voice could never connect. The shared resolver aims it at the real API
      // origin in the app and at the current host on the web. See lib/apiBase.resolveWebSocketUrl.
      const ws = new WebSocket(resolveWebSocketUrl(
        `/api/sonic/stream?token=${encodeURIComponent(token)}&voice=${voice}&boli=${boli}`,
        window as never,
      ));
      wsRef.current = ws;

      ws.onopen = () => {
        // Send the persona + prior text conversation FIRST so the server starts the session as
        // this professional and CONTINUES the chat (before any audio is streamed).
        try { ws.send(JSON.stringify({ type: 'init', professionalId, history: history?.slice(-12) })); } catch { /* will retry via audio */ }
        setStatus('live');
      };
      ws.onerror = () => { setError('Connection error.'); setStatus('error'); };
      ws.onclose = () => setStatus((s) => (s === 'error' ? 'error' : 'idle'));
      ws.onmessage = (ev) => {
        let msg: {
          type?: string; data?: string; text?: string; role?: string; message?: string;
          seconds?: number; reason?: string;
        };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'audio' && msg.data) playChunk(msg.data);
        else if (msg.type === 'interrupted') flushPlayback();
        else if (msg.type === 'text' && msg.text) setLines((l) => [...l, { role: msg.role || 'ASSISTANT', text: msg.text! }]);
        // The meter the user watches. It carries the SERVER's billed seconds, never a number counted
        // locally: a client-side stopwatch would drift from the wallet and end up showing a different
        // figure from the one actually charged. If the server has not spoken yet, nothing is shown.
        else if (msg.type === 'billing' && typeof msg.seconds === 'number') setBilledSeconds(msg.seconds);
        // The call ended for a real, nameable reason — say which, instead of a bare disconnect that
        // looks like a bug.
        else if (msg.type === 'ended') {
          setError(msg.reason === 'no_balance'
            ? 'Your balance ran out, so the call ended here. Add credit to carry on.'
            : 'This call reached its maximum length and ended here.');
          setStatus('error');
        }
        else if (msg.type === 'error') { setError(msg.message || 'Voice error.'); setStatus('error'); }
      };

      proc.onaudioprocess = (e) => {
        // Muted: the mic keeps running (fast un-mute) but NOTHING leaves the device — the assistant
        // genuinely cannot hear you until you un-mute (the waveform's mic bars are gated on mute too).
        if (mutedRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const down = downsampleFloat32(new Float32Array(input), micCtx.sampleRate, MIC_RATE);
        if (down.length === 0) return;
        ws.send(JSON.stringify({ type: 'audio', data: float32ToBase64PCM16(down) }));
      };

      // REAL mic spectrum for the waveform — a tap on the same source (does not affect what is sent).
      const micAnalyser = micCtx.createAnalyser();
      micAnalyser.fftSize = 128;
      source.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;

      source.connect(proc);
      proc.connect(micCtx.destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      setStatus('error');
      stop();
    }
  }, [playChunk, flushPlayback, stop, voice, boli, professionalId, history]);

  // Toggle mic mute mid-call. Mirrored into a ref so the audio callback sees it without re-binding.
  const toggleMute = useCallback(() => {
    setMuted((m) => { const next = !m; mutedRef.current = next; return next; });
  }, []);

  useEffect(() => () => stop(), [stop]);

  const live = status === 'live' || status === 'connecting';
  const stateLabel = status === 'connecting' ? 'Connecting…'
    : status === 'live' ? (muted ? 'Muted — tap 🎙 to speak' : speaking ? 'Speaking…' : 'Listening…')
    : status === 'error' ? 'Something went wrong'
    : 'Tap the mic to start';

  const lastLine = lines.length ? lines[lines.length - 1] : null;

  // COMPACT voice widget (admin 2026-07-14: "full screen hata do, ui theek hai"). A bottom-docked
  // card — NOT a full-screen takeover. It is still PORTALED to <body> (technical necessity, not the
  // full-screen the admin meant): the SDA/professional chat has transformed ancestors, and a
  // `position: fixed` element nested under a CSS-transformed ancestor is positioned relative to that
  // ancestor, not the viewport — which trapped the widget in a tiny strip. The portal escapes that so
  // the compact card docks correctly at the bottom-centre. A transparent full-viewport catcher behind
  // it closes the widget on an outside tap without dimming/taking over the screen.
  if (typeof document === 'undefined') return null;
  const barColor = status !== 'live' ? '#6b7280' : speaking ? '#a78bfa' : '#34d399';
  const waveform = (
    <div style={waveWrap} aria-hidden="true">
      {Array.from({ length: NBARS }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{ ...waveBar, background: barColor, transition: 'background 0.25s linear' }}
        />
      ))}
    </div>
  );
  return createPortal(
    <div
      style={catcher}
      onClick={(e) => { if (e.target === e.currentTarget && onClose) { stop(); onClose(); } }}
    >
    <div style={card}>
      {/* Top bar: brand + close. NO provider/model name anywhere. */}
      <div style={topBar}>
        <span style={brand}>NavBharatAI <span style={{ opacity: 0.6, fontWeight: 500 }}>Voice</span></span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowTranscript((v) => !v)} aria-label="Transcript" title="Transcript" style={iconBtn}>
            {showTranscript ? '🗨' : '💬'}
          </button>
          {onClose && (
            <button onClick={() => { stop(); onClose(); }} aria-label="Close" title="Close" style={iconBtn}>✕</button>
          )}
        </div>
      </div>

      {status === 'disabled' ? (
        <div style={centerCol}>
          {waveform}
          <p style={{ opacity: 0.75, maxWidth: 320, textAlign: 'center', marginTop: 18, fontSize: 14 }}>
            Voice isn’t available right now. Please try again later.
          </p>
        </div>
      ) : (
        <>
          <div style={centerCol}>
            {/* Live audio-reactive waveform — bar heights come from REAL mic + playback levels (rAF above). */}
            {waveform}
            <p style={stateText}>{stateLabel}</p>
            {status === 'live' && (
              <span style={{ marginTop: 4, fontSize: 12, letterSpacing: 1, color: speaking ? '#a78bfa' : '#34d399' }}>
                ● {speaking ? 'AI speaking' : 'Listening to you'}
              </span>
            )}
            {/* THE LIVE METER (admin 2026-08-10). Shown only once the server has reported a real tick,
                so it can never display a cost that has not actually been charged. Time AND money
                together — a number on its own tells the user nothing about whether to keep talking. */}
            {status === 'live' && billedSeconds !== null && billedSeconds > 0 && (
              <span style={{ marginTop: 6, fontSize: 11, color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                {voiceRunningCostLabel(billedSeconds, resolveVoiceLang((k) => localStorage.getItem(k)))}
              </span>
            )}
            {error && <p style={{ color: '#f87171', marginTop: 12, maxWidth: 340, textAlign: 'center', fontSize: 13 }}>⚠️ {error}</p>}

            {/* Minimal live caption (last line) when the transcript panel is closed. */}
            {!showTranscript && lastLine && (
              <p style={caption}>
                <span style={{ opacity: 0.5 }}>{lastLine.role === 'USER' ? 'You: ' : ''}</span>{lastLine.text}
              </p>
            )}
          </div>

          {/* Optional full transcript, slides up above the controls. */}
          {showTranscript && (
            <div style={transcriptPanel}>
              {lines.length === 0
                ? <p style={{ opacity: 0.5, textAlign: 'center', margin: 'auto' }}>Your conversation will appear here.</p>
                : lines.map((l, i) => (
                  <div key={i} style={{ marginBottom: 10, opacity: l.role === 'USER' ? 0.7 : 1 }}>
                    <strong style={{ color: l.role === 'USER' ? '#9ca3af' : '#c4b5fd' }}>{l.role === 'USER' ? 'You' : 'AI'}: </strong>
                    <span>{l.text}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Bottom control: one big mic/stop button, like ChatGPT/Grok voice mode. */}
          <div style={controls}>
            {/* Voice + boli pickers — chosen before starting; locked once a call is live. */}
            {!live && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={voiceToggle} role="group" aria-label="Voice">
                  <button
                    onClick={() => setVoice('female')}
                    aria-pressed={voice === 'female'}
                    style={{ ...voicePill, ...(voice === 'female' ? voicePillOn : {}) }}
                  >♀ Female</button>
                  <button
                    onClick={() => setVoice('male')}
                    aria-pressed={voice === 'male'}
                    style={{ ...voicePill, ...(voice === 'male' ? voicePillOn : {}) }}
                  >♂ Male</button>
                </div>
                {/* Regional boli — shifts tone/warmth only; language stays whatever YOU speak. */}
                <label style={boliRow}>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>Boli</span>
                  <select
                    value={boli}
                    onChange={(e) => setBoli(e.target.value as SonicBoli)}
                    aria-label="Regional boli (speaking style)"
                    title="Regional speaking style — tone only, your language stays the same"
                    style={boliSelect}
                  >
                    {BOLI_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id} style={{ color: '#111' }}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              {/* Mute — only while a call is live. Interrupt/barge-in is automatic (speak to cut in);
                  mute is the explicit "assistant can't hear me" control. */}
              {status === 'live' && (
                <button
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-pressed={muted}
                  title={muted ? 'Unmute' : 'Mute'}
                  style={{ ...sideBtn, ...(muted ? sideBtnOn : {}) }}
                >
                  <span style={{ fontSize: 22 }}>{muted ? '🔇' : '🎙'}</span>
                </button>
              )}
              {/* A device with no getUserMedia at all can never do this, so the control is ABSENT rather
                  than dead — the exact shape Apple rejected this app for once ("The microphone button
                  is unresponsive", Guideline 2.1(a), 2026-08-02). A phone that simply has not been
                  ASKED yet still shows the button: supported is not the same as permitted. */}
              {!micAvailable ? (
                <div style={{ fontSize: 13, opacity: 0.75, maxWidth: 260, textAlign: 'center' }}>
                  {micMessage('unsupported')}
                </div>
              ) : (
                <button
                  onClick={live ? stop : start}
                  aria-label={live ? 'Stop' : 'Start talking'}
                  style={{ ...micBtn, background: live ? '#dc2626' : 'linear-gradient(135deg,#6d28d9,#7c3aed)' }}
                >
                  {status === 'connecting'
                    ? <span style={{ fontSize: 15, fontWeight: 700 }}>…</span>
                    : live ? <span style={{ fontSize: 20 }}>◼</span> : <span style={{ fontSize: 26 }}>🎤</span>}
                </button>
              )}
              {/* Spacer keeps the main mic button centred when the mute button is present. */}
              {status === 'live' && <div style={{ width: 56, height: 56 }} aria-hidden="true" />}
            </div>
          </div>
        </>
      )}
    </div>
    </div>,
    document.body,
  );
}

// Transparent full-viewport catcher — closes on an outside tap; does NOT dim or take over the screen
// (admin: not full-screen). Docks the compact card at the bottom-centre, above the safe area.
const catcher: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2147483001,
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center',
  padding: `16px 12px calc(16px + env(safe-area-inset-bottom, 0px))`,
  pointerEvents: 'auto',
};
const card: React.CSSProperties = {
  width: 'min(440px, 96vw)', boxSizing: 'border-box',
  background: 'linear-gradient(160deg, #1b1030 0%, #120b22 60%, #0b0716 100%)',
  color: '#f5f3ff', display: 'flex', flexDirection: 'column',
  borderRadius: 22, border: '1px solid rgba(168,139,250,0.28)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(124,58,237,0.15)',
  fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
};
// The audio-reactive equaliser — a row of bars whose heights come from REAL audio (see the rAF loop).
const waveWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 56,
};
const waveBar: React.CSSProperties = {
  width: 6, height: 8, borderRadius: 999, willChange: 'height',
};
const topBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 14px', flexShrink: 0,
};
const brand: React.CSSProperties = { fontSize: 16, fontWeight: 800, letterSpacing: 0.2 };
const iconBtn: React.CSSProperties = {
  width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)', color: '#f5f3ff', fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const centerCol: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '8px 20px 4px', minHeight: 0,
};
const stateText: React.CSSProperties = { marginTop: 14, fontSize: 15, fontWeight: 600, opacity: 0.9 };
const caption: React.CSSProperties = {
  marginTop: 12, maxWidth: 400, textAlign: 'center', fontSize: 14, lineHeight: 1.45,
  opacity: 0.9, padding: '0 8px', maxHeight: 60, overflow: 'hidden',
};
const transcriptPanel: React.CSSProperties = {
  flexShrink: 0, maxHeight: '28vh', overflowY: 'auto', margin: '0 14px',
  padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)', fontSize: 13.5, lineHeight: 1.5,
  display: 'flex', flexDirection: 'column',
};
const controls: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
  padding: '14px 0 20px', flexShrink: 0,
};
const voiceToggle: React.CSSProperties = {
  display: 'inline-flex', padding: 4, borderRadius: 999, gap: 4,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
};
const voicePill: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#c4b5fd', cursor: 'pointer',
  fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 999,
};
const voicePillOn: React.CSSProperties = { background: 'linear-gradient(135deg,#6d28d9,#7c3aed)', color: '#fff' };
const boliRow: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const boliSelect: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#f5f3ff',
  borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none',
};
const micBtn: React.CSSProperties = {
  width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 8px 30px rgba(124,58,237,0.5)',
};
const sideBtn: React.CSSProperties = {
  width: 56, height: 56, borderRadius: '50%', cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.07)', color: '#f5f3ff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const sideBtnOn: React.CSSProperties = {
  background: 'rgba(220,38,38,0.22)', border: '1px solid rgba(248,113,113,0.5)', color: '#fecaca',
};
