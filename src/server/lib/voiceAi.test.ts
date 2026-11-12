import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./providerSwitches', () => ({ isProviderSwitchedOff: vi.fn(() => false) }));
vi.mock('./aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}) }));
vi.mock('../AI/inferencePolicy', () => ({ assertLegacyInferenceAllowed: vi.fn() }));
import { isProviderSwitchedOff } from './providerSwitches';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { voiceAiConfig, voiceCharacters, voicePrice, readVoiceInput, parseVoiceAudio, synthesizeVoice } from './voiceAi';
const env = { VOICE_AI_ENABLED: '1', SARVAM_API_KEY: 'synthetic-test-key', SARVAM_TTS_INR_PER_1000_CHARS: '1', SARVAM_TTS_COST_TAX_PERCENT: '18' };
const input = { text: 'नमस्ते', language: 'hi-IN', voice: 'shubh_hi_customer', requestId: '12345678-1234-4123-8123-123456789012', acceptedPriceInr: .02 };
function wav(): string {
  const b = Buffer.alloc(46); b.write('RIFF'); b.writeUInt32LE(38,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(22050,24); b.writeUInt32LE(44100,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(2,40);
  return b.toString('base64');
}
beforeEach(() => vi.clearAllMocks());
describe('Voice AI explicit pricing and validation', () => {
  it('quotes twice configured tax-inclusive supplier rate without credentials in public config', () => {
    expect(voiceAiConfig(env)).toMatchObject({ available: true, pricePer1000CharactersInr: 2.36, maxCharacters: 2500 });
    expect(JSON.stringify(voiceAiConfig(env))).not.toContain(env.SARVAM_API_KEY);
  });
  it.each(['', 'NaN', '-1', 'Infinity', '0.00000001'])('disables invalid rate %s', rate => expect(voiceAiConfig({ ...env, SARVAM_TTS_INR_PER_1000_CHARS: rate }).available).toBe(false));
  it('requires explicit tax, key, enable and switch', () => {
    for (const field of Object.keys(env)) expect(voiceAiConfig({ ...env, [field]: undefined }).available).toBe(false);
    vi.mocked(isProviderSwitchedOff).mockReturnValueOnce(true); expect(voiceAiConfig(env).available).toBe(false);
  });
  it('uses codepoints including whitespace without altering text and preserves fractional retail quotes', () => {
    expect(voiceCharacters('😀 नमस्ते')).toBe(Array.from('😀 नमस्ते').length);
    expect(voicePrice('a',2.36)).toBe(.00236); expect(voicePrice('a'.repeat(1000),2.36)).toBe(2.36);
    expect(readVoiceInput({ ...input, text: ' नमस्ते ' }).text).toBe(' नमस्ते ');
  });
  it.each([{endpoint:'https://untrusted.example'},{text:''},{text:' '},{text:'a'.repeat(2501)},{text:'\u0000'},{language:'xx'},{voice:'https://evil.test'},{requestId:'same'},{acceptedPriceInr:Infinity},{acceptedPriceInr:0},{language:'en-IN'}])('rejects malformed or incompatible input %o', patch => expect(() => readVoiceInput({...input,...patch})).toThrow('invalid'));
});
describe('Voice AI bounded provider output', () => {
  it('accepts real PCM WAV framing only', () => expect(parseVoiceAudio({audios:[wav()]})).toBe(wav()));
  it.each([null, {}, {audios:[]}, {audios:['abc']}, {audios:[wav(),wav()]}, {audios:[Buffer.from('not audio').toString('base64')]}])('rejects malformed output %o', value => expect(() => parseVoiceAudio(value)).toThrow('provider_failed'));
  it('rejects truncated chunks and header-only files', () => {
    const b=Buffer.from(wav(),'base64'); b.writeUInt32LE(100,40); expect(()=>parseVoiceAudio({audios:[b.toString('base64')]})).toThrow();
    b.writeUInt32LE(0,40); expect(()=>parseVoiceAudio({audios:[b.subarray(0,44).toString('base64')]})).toThrow();
  });
  it('calls exactly the pinned endpoint/model once with server-only key and no redirects', async () => {
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({audios:[wav()]})));
    expect(await synthesizeVoice(input,new AbortController().signal,fetcher as typeof fetch,env)).toBe(wav());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.sarvam.ai/text-to-speech'); expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toMatchObject({model:'bulbul:v4-flash',text:input.text,output_audio_codec:'wav'});
  });
  it.each([402,429,500])('does not retry HTTP %s or surface provider secrets', async status=>{
    const fetcher=vi.fn(async()=>new Response('synthetic secret upstream',{status}));
    await expect(synthesizeVoice(input,new AbortController().signal,fetcher as typeof fetch,env)).rejects.toThrow('provider_failed'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses a pre-cancelled request without HTTP',async()=>{
    const controller=new AbortController(); controller.abort(); const fetcher=vi.fn();
    await expect(synthesizeVoice(input,controller.signal,fetcher,env)).rejects.toThrow('cancelled');expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns on cancellation even when transport ignores abort and cancels a late response', async () => {
    let resolve!: (r:Response)=>void;
    const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));
    const controller=new AbortController();
    const pending=synthesizeVoice(input,controller.signal,fetcher as typeof fetch,env);
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await expect(pending).rejects.toThrow('cancelled');
    const response=new Response(JSON.stringify({audios:[wav()]}));
    const cancel=vi.spyOn(response.body!, 'cancel'); resolve(response);
    await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('maintenance and strict-free checks happen before dispatch',async()=>{
    const fetcher=vi.fn();vi.mocked(assertAiAvailable).mockRejectedValueOnce(new Error('maintenance'));
    await expect(synthesizeVoice(input,new AbortController().signal,fetcher,env)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
    vi.mocked(assertLegacyInferenceAllowed).mockImplementationOnce(()=>{throw new Error('strict-free');});
    await expect(synthesizeVoice(input,new AbortController().signal,fetcher,env)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
});
