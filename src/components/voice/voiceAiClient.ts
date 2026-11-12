export interface VoiceConfig {
  available: boolean;
  maxCharacters: number;
  pricePer1000CharactersInr: number | null;
  languages: { code: string; label: string }[];
  voices: { id: string; label: string; language: string }[];
}

export const voiceCharacters = (text: string): number => Array.from(text).length;
export const voicePrice = (characters: number, rate: number): number => Number((characters * rate / 1000).toFixed(6));

/** Display the authoritative decimal-six quote without hiding fractional paise. */
export const formatVoicePrice = (price: number): string => price.toFixed(6).replace(/(\.\d{2,}?)0+$/, '$1');
export const voiceReservation = (price: number): string => (Math.ceil((price - Number.EPSILON) * 100) / 100).toFixed(2);

/** Fail closed if the server cannot provide the choices and price the user must approve. */
export function validVoiceConfig(value: unknown): value is VoiceConfig {
  const c = value as VoiceConfig | null;
  return !!c && typeof c.available === 'boolean' && Number.isInteger(c.maxCharacters) && c.maxCharacters > 0
    && c.maxCharacters <= 2500 && ((!c.available && c.pricePer1000CharactersInr === null) || (typeof c.pricePer1000CharactersInr === 'number' && Number.isFinite(c.pricePer1000CharactersInr) && c.pricePer1000CharactersInr > 0))
    && Array.isArray(c.languages) && c.languages.length > 0
    && c.languages.every(l => !!l && typeof l.code === 'string' && typeof l.label === 'string')
    && Array.isArray(c.voices) && c.voices.length > 0
    && c.voices.every(v => !!v && typeof v.id === 'string' && typeof v.label === 'string' && typeof v.language === 'string');
}

/** Decode only a real WAV container, never an arbitrary provider URL or HTML response. */
export function voiceAudioBlob(audio: string, mimeType: string): Blob {
  if (mimeType !== 'audio/wav' || typeof audio !== 'string' || audio.length > 40_000_000) throw new Error('Invalid audio response.');
  const binary = atob(audio);
  if (binary.length < 44 || binary.slice(0, 4) !== 'RIFF' || binary.slice(8, 12) !== 'WAVE') throw new Error('Invalid audio response.');
  return new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'audio/wav' });
}
