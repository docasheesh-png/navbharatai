import { describe, it, expect, afterEach } from 'vitest';
import { speechRecognitionSupported } from '../src/lib/voiceInput';

// Apple App Review rejected v1.0(46) under Guideline 2.1(a) — "The microphone button is unresponsive" —
// because the Web Speech API does not exist in iOS/iPadOS WKWebView (the Capacitor native app). This
// helper is the single gate every mic button renders behind, so an unsupported platform shows NO button
// (honest not-available) instead of a dead one. These tests lock that contract.
//
// The repo's vitest runs in the `node` environment (no jsdom), so we drive `globalThis.window` directly.
const g = globalThis as unknown as { window?: unknown };

describe('speechRecognitionSupported — the mic-button render gate', () => {
  afterEach(() => {
    delete g.window;
  });

  it('is FALSE when there is no window (SSR / non-browser)', () => {
    delete g.window;
    expect(speechRecognitionSupported()).toBe(false);
  });

  it('is FALSE when window exists but neither global is present (iOS/iPadOS WKWebView — the App Review case)', () => {
    g.window = {};
    expect(speechRecognitionSupported()).toBe(false);
  });

  it('is TRUE when webkitSpeechRecognition is a constructor (iOS Safari / older Chrome)', () => {
    g.window = { webkitSpeechRecognition: function () {} };
    expect(speechRecognitionSupported()).toBe(true);
  });

  it('is TRUE when the standard SpeechRecognition is a constructor (desktop Chrome/Edge)', () => {
    g.window = { SpeechRecognition: function () {} };
    expect(speechRecognitionSupported()).toBe(true);
  });

  it('is FALSE when the global exists but is NOT callable (a non-constructor value)', () => {
    // A truthy-but-unusable value must not pass — the old `!!(...)` checks would have wrongly returned true.
    g.window = { webkitSpeechRecognition: {} };
    expect(speechRecognitionSupported()).toBe(false);
  });
});
