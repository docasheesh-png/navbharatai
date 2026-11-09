import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { voiceCharacters, voicePrice, formatVoicePrice, voiceReservation, validVoiceConfig, voiceAudioBlob } from './voiceAiClient';
import { newModeEntries, recentModeEntries, activeModeId, isModeSurface } from '../chat/modePicker';
import { addViewWindow, chatSlotsUsed } from '../../lib/chatWindows';
import { parentForOpen } from '../../lib/tabParenting';

const config = { available: true, maxCharacters: 2500, pricePer1000CharactersInr: 15, languages: [{ code: 'hi-IN', label: 'Hindi' }], voices: [{ id: 'test', label: 'Test', language: '*' }] };

describe('Voice AI controls and pricing', () => {
  it('counts Unicode code points, preserves spaces and retains fractional-paise pricing', () => {
    expect(voiceCharacters('अ🙂 ')).toBe(3);
    expect(voicePrice(3, 15)).toBe(0.045);
    expect(voicePrice(1, 2.36)).toBe(0.00236);
    expect(voicePrice(1, 1.23456789)).toBe(0.001235);
    expect(voicePrice(1000, 15)).toBe(15);
    expect(voicePrice(0, 15)).toBe(0);
  });
  it('shows up to six decimals, at least two, and distinguishes the temporary reservation', () => {
    expect(formatVoicePrice(0.045)).toBe('0.045');
    expect(formatVoicePrice(15)).toBe('15.00');
    expect(formatVoicePrice(0)).toBe('0.00');
    expect(formatVoicePrice(0.001235)).toBe('0.001235');
    expect(voiceReservation(0.045)).toBe('0.05');
    expect(voiceReservation(0.00236)).toBe('0.01');
    expect(voiceReservation(0)).toBe('0.00');
  });
  it('fails closed on missing options, invalid limits and nonpositive or invalid prices', () => {
    expect(validVoiceConfig(config)).toBe(true);
    expect(validVoiceConfig({ ...config, available: false, pricePer1000CharactersInr: null })).toBe(true);
    for (const changed of [{ pricePer1000CharactersInr: NaN }, { pricePer1000CharactersInr: 0 }, { maxCharacters: 9999 }, { voices: [] }, { languages: null }]) expect(validVoiceConfig({ ...config, ...changed })).toBe(false);
    expect(validVoiceConfig(null)).toBe(false);
  });
  it('delivers real WAV bytes rather than a provider link disguised as audio', async () => {
    const wav = 'RIFF' + '\0'.repeat(4) + 'WAVE' + '\0'.repeat(32);
    const blob = voiceAudioBlob(btoa(wav), 'audio/wav');
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44);
    expect(await blob.text()).toBe(wav);
    expect(() => voiceAudioBlob(btoa('<html>error</html>'), 'audio/wav')).toThrow();
    expect(() => voiceAudioBlob(btoa(wav), 'text/html')).toThrow();
  });
});

describe('Voice AI navigation and isolation', () => {
  it('puts Voice after Image and before Teacher in both medical visibility modes', () => {
    for (const hideMedical of [true, false]) {
      const ids = newModeEntries({ hideMedical }).map(x => x.id);
      expect(ids[ids.indexOf('imagegen') + 1]).toBe('voice_ai');
      expect(ids.indexOf('voice_ai')).toBeLessThan(ids.indexOf('teacher_ai'));
      expect(isModeSurface('voice_ai')).toBe(true);
    }
  });
  it('uses distinct recent windows, counts them toward the limit and inherits the actual parent', () => {
    const windows = addViewWindow([], ['voice_ai'], 'voice_ai', 'voice-second');
    const rows = recentModeEntries({ hideMedical: false, openViews: ['voice_ai'], viewWindows: windows });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: 'recent:voice_ai#voice-second', name: 'Voice AI (2)' });
    expect(activeModeId('voice_ai', null, 'voice-second')).toBe(rows[1].id);
    expect(chatSlotsUsed([], ['voice_ai'], windows)).toBe(2);
    expect(parentForOpen('voice_ai', 'teacher_ai', { teacher_ai: 'nbi_chat' })).toBe('nbi_chat');
    expect(parentForOpen('teacher_ai', 'voice_ai', { voice_ai: 'nbi_chat' })).toBe('nbi_chat');
  });
  it('wires authenticated explicit requests, no persistence, cancellation, provider disclosure and mobile file delivery', () => {
    const source = readFileSync(new URL('./VoiceAI.tsx', import.meta.url), 'utf8');
    expect(source).toContain("'/api/v1/voice-ai/generate'");
    expect(source).toContain('acceptedPriceInr: price');
    expect(source).toContain('crypto.randomUUID()');
    expect(source).toContain('auth.currentUser?.uid === account.uid');
    expect(source).toContain('version === epoch.current');
    expect(source).toContain("deliverFile('navbharatai-voice.wav', audio.blob, 'audio/wav')");
    expect(source).toContain('may still finish and be charged');
    expect(source).toContain('speech service provider');
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("key={`${user?.uid ?? 'guest'}:voice:${win.id}`}");
    expect(app).toContain("newSlotViewWindow('voice_ai')");
  });
});
