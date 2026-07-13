// Sonic Chat — an ISOLATED, experimental voice surface backed by Amazon Nova Sonic.
//
// Self-contained: it probes /api/sonic/status and renders nothing but an honest "not
// available" note unless the server says the feature is enabled (flag + AWS creds). When
// live, it captures the mic as 16 kHz PCM, streams it over the Sonic WebSocket, and plays
// back the 24 kHz PCM the model returns. Delete this folder + the server sonic/ folder to
// remove the experiment entirely.
//
// The real voice round-trip can only be verified in a browser on a deploy; the PCM math is
// unit-tested in sonicAudio.test.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { downsampleFloat32, float32ToBase64PCM16, base64PCM16ToFloat32 } from './sonicAudio';
import { auth } from '../../lib/firebase';

type Status = 'loading' | 'disabled' | 'idle' | 'connecting' | 'live' | 'error';
interface Line { role: string; text: string }

const MIC_RATE = 16000;
const OUT_RATE = 24000;

export function SonicChat({ onClose }: { onClose?: () => void } = {}) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayRef = useRef(0);

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
    }
    const float = base64PCM16ToFloat32(b64);
    if (float.length === 0) return;
    const buffer = ctx.createBuffer(1, float.length, OUT_RATE);
    buffer.copyToChannel(float, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayRef.current);
    src.start(startAt);
    nextPlayRef.current = startAt + buffer.duration;
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
    setStatus((s) => (s === 'error' ? 'error' : 'idle'));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLines([]);
    setStatus('connecting');
    try {
      // Logged-in users only — the server verifies this token before opening a (paid) stream.
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) { setError('Please sign in to use voice chat.'); setStatus('error'); return; }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const micCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      micCtxRef.current = micCtx;
      const source = micCtx.createMediaStreamSource(stream);
      const proc = micCtx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;

      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${wsProto}://${window.location.host}/api/sonic/stream?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => setStatus('live');
      ws.onerror = () => { setError('Connection error.'); setStatus('error'); };
      ws.onclose = () => setStatus((s) => (s === 'error' ? 'error' : 'idle'));
      ws.onmessage = (ev) => {
        let msg: { type?: string; data?: string; text?: string; role?: string; message?: string };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'audio' && msg.data) playChunk(msg.data);
        else if (msg.type === 'text' && msg.text) setLines((l) => [...l, { role: msg.role || 'ASSISTANT', text: msg.text! }]);
        else if (msg.type === 'error') { setError(msg.message || 'Sonic error.'); setStatus('error'); }
      };

      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const down = downsampleFloat32(new Float32Array(input), micCtx.sampleRate, MIC_RATE);
        if (down.length === 0) return;
        ws.send(JSON.stringify({ type: 'audio', data: float32ToBase64PCM16(down) }));
      };

      source.connect(proc);
      proc.connect(micCtx.destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      setStatus('error');
      stop();
    }
  }, [playChunk, stop]);

  useEffect(() => () => stop(), [stop]);

  if (status === 'loading') return <div style={wrap}>Loading…</div>;
  if (status === 'disabled') {
    return (
      <div style={wrap}>
        <h2 style={{ margin: 0 }}>🎙️ Sonic Voice Chat</h2>
        <p style={{ opacity: 0.8 }}>This experimental voice mode isn’t available right now. (The server needs Nova Sonic enabled and AWS credentials configured.)</p>
      </div>
    );
  }

  const live = status === 'live' || status === 'connecting';
  return (
    <div style={wrap}>
      {onClose && (
        <button onClick={() => { stop(); onClose(); }} aria-label="Close" style={closeBtn}>✕</button>
      )}
      <h2 style={{ margin: 0 }}>🎙️ Sonic Voice Chat <span style={{ fontSize: 12, opacity: 0.6 }}>(experimental)</span></h2>
      <p style={{ opacity: 0.8, marginTop: 4 }}>Talk naturally — powered by Amazon Nova Sonic. Speak in Hindi, English or Hinglish.</p>
      <button
        onClick={live ? stop : start}
        style={{ ...btn, background: live ? '#c0392b' : '#5b3df5' }}
      >
        {status === 'connecting' ? 'Connecting…' : live ? '⏹ Stop' : '🎤 Start talking'}
      </button>
      {status === 'live' && <span style={{ marginLeft: 12, color: '#2ecc71' }}>● Live</span>}
      {error && <p style={{ color: '#e74c3c' }}>⚠️ {error}</p>}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ opacity: l.role === 'USER' ? 0.7 : 1 }}>
            <strong>{l.role === 'USER' ? 'You' : 'AI'}:</strong> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { padding: 20, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif', position: 'relative' };
const btn: React.CSSProperties = { color: '#fff', border: 'none', borderRadius: 999, padding: '12px 24px', fontSize: 16, cursor: 'pointer' };
const closeBtn: React.CSSProperties = { position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', opacity: 0.6, lineHeight: 1 };
