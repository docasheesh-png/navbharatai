import { useEffect, useId, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import { deliverFile, deliveryMessage } from '../../lib/downloadFile';
import { ModeButton } from '../chat/ModeButton';
import { validVoiceConfig, voiceAudioBlob, voiceCharacters, voicePrice, formatVoicePrice, voiceReservation, type VoiceConfig } from './voiceAiClient';

class VoiceUiError extends Error {}

/** Each window is memory-only, keyed by account in App. Closing it discards its draft/audio. */
export function VoiceAI({ userId, onOpenModePicker, onScreen = true }: { userId?: string; onScreen?: boolean; onOpenModePicker?: () => void }) {
  const fieldId = useId();
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [reload, setReload] = useState(0);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('');
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<{ blob: Blob; url: string; chargedInr: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const audioElement = useRef<HTMLAudioElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current++; request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setConfigError(true); }, 15_000);
    setConfigError(false);
    setConfig(null);
    void fetch('/api/v1/voice-ai/config', { signal: controller.signal }).then(async res => {
      if (!res.ok) throw new Error('Config unavailable');
      const data: unknown = await res.json();
      if (!validVoiceConfig(data)) throw new Error('Config invalid');
      if (controller.signal.aborted) return;
      setConfig(data);
      setLanguage(data.languages[0].code);
      setVoice(data.voices.find(v => v.language === data.languages[0].code || v.language === '*')?.id ?? '');
    }).catch(() => { if (!controller.signal.aborted) setConfigError(true); }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [reload]);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  useEffect(() => { if (!onScreen) audioElement.current?.pause(); }, [onScreen]);

  const characters = voiceCharacters(text);
  const price = config?.pricePer1000CharactersInr != null ? voicePrice(characters, config.pricePer1000CharactersInr) : 0;
  const voices = config?.voices.filter(v => v.language === language || v.language === '*') ?? [];
  const ready = !!config?.available && !!userId && text.trim().length > 0 && characters <= config.maxCharacters
    && voices.some(v => v.id === voice) && !busy;

  const clear = () => {
    epoch.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
    audioElement.current?.pause();
    setText(''); setAudio(null); setError('');
    setNotice('Draft and audio cleared from this window.');
  };

  const generate = async () => {
    if (!ready || request.current) return;
    const account = auth.currentUser;
    if (!account || account.uid !== userId) { setError('Please sign in again before generating speech.'); return; }
    const controller = new AbortController();
    request.current = controller;
    const version = ++epoch.current;
    const current = () => mounted.current && version === epoch.current && !controller.signal.aborted && auth.currentUser?.uid === account.uid;
    setBusy(true); setError(''); setNotice('');
    audioElement.current?.pause();
    try {
      const token = await account.getIdToken();
      if (!current()) return;
      const response = await fetch('/api/v1/voice-ai/generate', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, language, voice, requestId: crypto.randomUUID(), acceptedPriceInr: price }),
      });
      if (!current()) return;
      if (!response.ok) {
        // Never reflect raw upstream errors (which can expose provider details or submitted text).
        const messages: Record<number, string> = {
          401: 'Please sign in again.', 402: 'Insufficient wallet balance. Add credit before generating speech.',
          409: 'This request could not be completed. Reload pricing and review the new cost before submitting again. Check your wallet first if an earlier request may have completed.',
          429: 'Too many requests. Please wait before trying again.', 503: 'Voice AI is temporarily unavailable.',
        };
        throw new VoiceUiError(messages[response.status] ?? 'Speech could not be generated. Check your wallet before submitting a new request.');
      }
      const data = await response.json();
      if (!current()) return;
      const blob = voiceAudioBlob(data.audio, data.mimeType);
      if (!Number.isFinite(data.chargedInr) || data.chargedInr < 0 || data.chargedInr > price) throw new VoiceUiError('Could not verify the audio charge. Check your wallet.');
      setAudio({ blob, url: URL.createObjectURL(blob), chargedInr: data.chargedInr });
      setNotice('Speech is ready. Download it before closing this window.');
    } catch (e) {
      if (current()) setError(e instanceof VoiceUiError ? e.message : 'Could not receive verified audio. The request may still finish and be charged. Check your wallet before generating again.');
    } finally {
      if (version === epoch.current && mounted.current) { setBusy(false); request.current = null; }
    }
  };

  const cancel = () => {
    epoch.current++; request.current?.abort(); request.current = null; setBusy(false);
    setNotice('Stopped waiting. A request already received by the server may still finish and be charged. Check your wallet before generating again.');
  };

  const download = async () => {
    if (!audio || saving) return;
    const version = epoch.current;
    setSaving(true);
    try {
      const result = await deliverFile('navbharatai-voice.wav', audio.blob, 'audio/wav');
      if (mounted.current && version === epoch.current) setNotice(deliveryMessage(result, 'navbharatai-voice.wav'));
    } catch { if (mounted.current && version === epoch.current) setError('Could not save the audio on this device.'); }
    finally { if (mounted.current) setSaving(false); }
  };

  return <section aria-label="Voice AI" className="flex-1 min-w-0 overflow-y-auto bg-surface text-body p-4 sm:p-6">
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">NavBharatAI Voice AI</h1>
        <ModeButton onOpen={onOpenModePicker} />
      </div>
      <p className="text-muted">Turn your text into AI-generated speech. Listen here or download a WAV audio file.</p>
      {configError ? <div role="alert" className="text-danger">Voice AI settings could not be loaded. <button type="button" className="underline" onClick={() => setReload(v => v + 1)}>Reload settings</button></div>
        : !config ? <p role="status">Loading voices and pricing…</p>
        : !config.available ? <p role="status" className="text-warn">Voice AI is not available yet. Please check back later.</p> : null}
      {!userId && <p className="text-warn">Sign in to generate speech using your wallet.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="min-w-0">Language
          <select className="mt-1 block w-full min-w-0 rounded-lg border border-line bg-card p-3 text-ink" value={language} disabled={!config || busy} onChange={e => { setLanguage(e.target.value); setVoice(config?.voices.find(v => v.language === e.target.value || v.language === '*')?.id ?? ''); }}>
            {config?.languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="min-w-0">Voice
          <select className="mt-1 block w-full min-w-0 rounded-lg border border-line bg-card p-3 text-ink" value={voice} disabled={!config || busy} onChange={e => setVoice(e.target.value)}>
            {voices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block" htmlFor={`${fieldId}-script`}>Text to speak</label>
      <textarea id={`${fieldId}-script`} className="block w-full min-w-0 min-h-48 resize-y rounded-xl border border-line bg-card p-3 text-ink" value={text} maxLength={(config?.maxCharacters ?? 2500) * 2} disabled={busy} onChange={e => setText(e.target.value)} placeholder="Write the words you want to hear…" aria-describedby={`${fieldId}-count ${fieldId}-privacy`} />
      <p id={`${fieldId}-count`} className={config && characters > config.maxCharacters ? 'text-danger' : 'text-muted'}>{characters} / {config?.maxCharacters ?? 2500} characters</p>
      <p id={`${fieldId}-privacy`} className="text-sm text-muted">Generating sends this text to our speech service provider. Do not enter passwords, financial details or other sensitive personal information. Use text you have permission to use. Preset voices only; no voice cloning. Drafts and audio are not saved in history.</p>
      {config?.pricePer1000CharactersInr != null && <p className="font-medium text-ink">Cost: ₹{formatVoicePrice(price)} from your wallet · ₹{formatVoicePrice(config.pricePer1000CharactersInr)} per 1,000 characters.</p>}
      {config?.pricePer1000CharactersInr != null && <p className="text-sm text-muted">Up to ₹{voiceReservation(price)} temporarily reserved; only displayed exact price charged for completed audio. No minimum fee.</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || !config} onClick={() => { setReload(v => v + 1); setError(''); setNotice('Reloading pricing. Your draft is kept. Review the updated cost before generating.'); }} className="rounded-lg border border-line px-4 py-3 disabled:opacity-50">Reload pricing</button>
        <button type="button" disabled={!ready} onClick={() => void generate()} className="rounded-lg bg-accent px-4 py-3 text-on-accent disabled:opacity-50">{busy ? 'Generating…' : `Generate speech · ₹${formatVoicePrice(price)}`}</button>
        {busy ? <button type="button" onClick={cancel} className="rounded-lg border border-line px-4 py-3">Stop waiting</button> : <button type="button" onClick={clear} className="rounded-lg border border-line px-4 py-3">Clear</button>}
      </div>
      {error && <p role="alert" className="text-danger break-words">{error}</p>}
      {notice && <p role="status" className="text-muted break-words">{notice}</p>}
      {audio && <div className="space-y-3 rounded-xl border border-line bg-card p-4">
        <audio ref={audioElement} controls src={audio.url} className="w-full min-w-0" aria-label="Generated speech" />
        <p>Wallet price: ₹{formatVoicePrice(audio.chargedInr)} for this AI-generated audio.</p>
        <button type="button" disabled={saving} onClick={() => void download()} className="rounded-lg border border-line px-4 py-3">{saving ? 'Saving…' : 'Download WAV'}</button>
      </div>}
    </div>
  </section>;
}
