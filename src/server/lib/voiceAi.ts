import { isProviderSwitchedOff } from './providerSwitches';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';

export const VOICE_MAX_CHARACTERS = 2500;
export const VOICE_TIMEOUT_MS = 45_000;
export const VOICE_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const VOICE_LANGUAGES = [
  { code: 'hi-IN', label: 'Hindi' }, { code: 'en-IN', label: 'English' },
  { code: 'bn-IN', label: 'Bengali' }, { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' }, { code: 'kn-IN', label: 'Kannada' },
  { code: 'mr-IN', label: 'Marathi' }, { code: 'gu-IN', label: 'Gujarati' },
  { code: 'pa-IN', label: 'Punjabi' },
] as const;
// Only official, reviewed built-in personas. No cloning, user-supplied model, voice URL or endpoint.
export const VOICE_VOICES = [
  { id: 'shubh_hi_customer', label: 'Shubh', language: 'hi-IN' },
  { id: 'simran_en_customer', label: 'Simran', language: 'en-IN' },
  { id: 'ishita_mr_conversational', label: 'Ishita', language: 'mr-IN' },
  { id: 'chaitra_kn_conversation', label: 'Chaitra', language: 'kn-IN' },
  { id: 'anand_pa_conversation', label: 'Anand', language: 'pa-IN' },
  { id: 'gokul_ta_narration', label: 'Gokul', language: 'ta-IN' },
  { id: 'kavitha_te_conversation', label: 'Kavitha', language: 'te-IN' },
  { id: 'pooja_gu_conversational', label: 'Pooja', language: 'gu-IN' },
  { id: 'roopa_bn_conversational', label: 'Roopa', language: 'bn-IN' },
] as const;
export class VoiceAiError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'price_changed' | 'provider_failed' | 'cancelled' | 'busy' | 'duplicate' | 'insufficient' | 'storage', readonly status = 503) { super(code); }
}
const number = (value: string | undefined): number | null => value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function voiceAiConfig(env: NodeJS.ProcessEnv = process.env) {
  const base = number(env.SARVAM_TTS_INR_PER_1000_CHARS);
  const tax = number(env.SARVAM_TTS_COST_TAX_PERCENT);
  // Owner approved 2x effective supplier cost. A tax rate is explicit, never inferred from an address.
  const rate = base !== null && base >= 0.001 && base <= 1000 && tax !== null && tax >= 0 && tax <= 100 ? base * (1 + tax / 100) * 2 : null;
  return { available: env.VOICE_AI_ENABLED === '1' && !!env.SARVAM_API_KEY?.trim() && rate !== null && !isProviderSwitchedOff('sarvam'),
    pricePer1000CharactersInr: rate, maxCharacters: VOICE_MAX_CHARACTERS,
    languages: VOICE_LANGUAGES, voices: VOICE_VOICES };
}
export interface VoiceAiInput { text: string; language: string; voice: string; requestId: string; acceptedPriceInr: number }
export const voiceCharacters = (text: string) => Array.from(text).length;
export function voicePrice(text: string, rate: number): number {
  return Number((voiceCharacters(text) * rate / 1000).toFixed(6));
}
export function readVoiceInput(value: unknown): VoiceAiInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VoiceAiError('invalid', 400);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['text', 'language', 'voice', 'requestId', 'acceptedPriceInr'].includes(key))
    || typeof v.text !== 'string' || !v.text.trim() || v.text.length > VOICE_MAX_CHARACTERS * 2 || voiceCharacters(v.text) > VOICE_MAX_CHARACTERS
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v.text)
    || !VOICE_LANGUAGES.some(l => l.code === v.language) || !VOICE_VOICES.some(s => s.id === v.voice && (s.language as string) === v.language)
    || typeof v.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.requestId)
    || typeof v.acceptedPriceInr !== 'number' || !Number.isFinite(v.acceptedPriceInr) || v.acceptedPriceInr <= 0) throw new VoiceAiError('invalid', 400);
  return v as unknown as VoiceAiInput;
}
export function parseVoiceAudio(value: unknown): string {
  const audios = (value as { audios?: unknown })?.audios;
  if (!Array.isArray(audios) || audios.length !== 1 || typeof audios[0] !== 'string' || audios[0].length > VOICE_MAX_RESPONSE_BYTES
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(audios[0]) || audios[0].length % 4 !== 0) throw new VoiceAiError('provider_failed', 502);
  const buf = Buffer.from(audios[0], 'base64');
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE'
    || buf.readUInt32LE(4) + 8 !== buf.length) throw new VoiceAiError('provider_failed', 502);
  let offset = 12; let format = false; let data = false; let blockAlign = 0; let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const tag = buf.toString('ascii', offset, offset + 4), length = buf.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length;
    if (end > buf.length) throw new VoiceAiError('provider_failed', 502);
    if (tag === 'fmt ') {
      if (format || length < 16) throw new VoiceAiError('provider_failed', 502);
      const encoding = buf.readUInt16LE(start), channels = buf.readUInt16LE(start + 2);
      const sampleRate = buf.readUInt32LE(start + 4), bits = buf.readUInt16LE(start + 14);
      blockAlign = buf.readUInt16LE(start + 12);
      // Accept validated uncompressed PCM/float WAV without assuming undocumented bit depth.
      if (![1, 3].includes(encoding) || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 192000
        || !(encoding === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits)
        || blockAlign !== channels * bits / 8 || buf.readUInt32LE(start + 8) !== sampleRate * blockAlign) throw new VoiceAiError('provider_failed', 502);
      format = true;
    }
    if (tag === 'data') { if (data || length === 0) throw new VoiceAiError('provider_failed', 502); data = true; dataSize = length; }
    offset = end + (length % 2);
  }
  if (!format || !data || dataSize % blockAlign !== 0 || offset !== buf.length) throw new VoiceAiError('provider_failed', 502);
  return audios[0];
}
// A non-cooperative transport keeps its local slot until it actually settles. A timeout
// never invents proof that an upstream job stopped; there is no retry of that attempt.
let activeTransports = 0;
const MAX_LOCAL_TRANSPORTS = 8;
/** One bounded HTTP attempt; no fallback, no redirects, no secret/body logging. */
export async function synthesizeVoice(input: VoiceAiInput, signal: AbortSignal, fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  await assertAiAvailable();
  assertLegacyInferenceAllowed('text-to-speech');
  if (!voiceAiConfig(env).available) throw new VoiceAiError('unavailable');
  const abort = AbortSignal.any([signal, AbortSignal.timeout(VOICE_TIMEOUT_MS)]);
  if (abort.aborted) throw new VoiceAiError('cancelled', 499);
  if (activeTransports >= MAX_LOCAL_TRANSPORTS) throw new VoiceAiError('busy', 429);
  activeTransports++;
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new VoiceAiError(signal.aborted ? 'cancelled' : 'provider_failed', signal.aborted ? 499 : 502));
    abort.addEventListener('abort', rejectAbort, { once: true });
  });
  const work = (async () => {
    try {
      const res = await fetcher('https://api.sarvam.ai/text-to-speech', { method: 'POST', redirect: 'error', signal: abort,
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': env.SARVAM_API_KEY!.trim() },
        body: JSON.stringify({ text: input.text, language_code: input.language, speaker: input.voice, model: 'bulbul:v4-flash',
          output_audio_codec: 'wav', speech_sample_rate: 22050, pace: 1 }) });
      if (abort.aborted || !res.ok || !res.body) { void res.body?.cancel().catch(() => {}); throw new VoiceAiError('provider_failed', 502); }
      const reader = res.body.getReader();
      const parts: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      abort.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (abort.aborted) throw new VoiceAiError('provider_failed', 502);
          if (done) break;
          size += value.byteLength;
          if (size > VOICE_MAX_RESPONSE_BYTES) throw new VoiceAiError('provider_failed', 502);
          parts.push(value);
        }
        return parseVoiceAudio(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } finally { abort.removeEventListener('abort', cancel); cancel(); }
    } finally { activeTransports--; }
  })();
  try { return await Promise.race([work, aborted]); }
  catch (error) {
    if (error instanceof VoiceAiError) throw error;
    throw new VoiceAiError(signal.aborted ? 'cancelled' : 'provider_failed', signal.aborted ? 499 : 502);
  } finally { if (rejectAbort) abort.removeEventListener('abort', rejectAbort); }
}
