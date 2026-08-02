// Single source of truth for "is browser speech-to-text (the Web Speech API) available on this device?".
//
// The Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) exists in desktop Chrome/Edge, but
// is NOT exposed in iOS/iPadOS WKWebView — the exact runtime of the Capacitor native app. A mic button
// wired to it there is a dead, "unresponsive" control: Apple App Review rejected v1.0(46) under Guideline
// 2.1(a) App Completeness on an iPad ("The microphone button is unresponsive", 2026-08-02).
//
// The root-cause fix (and the "real features only / honest not-available state" rule): gate every mic
// button's RENDER on this helper, so an unsupported platform simply shows no button — never a broken one.
// Previously each chat re-implemented this check inline and drifted (some hid the button, some fired an
// `alert('use Chrome')` — which also violates Apple's rule against pointing users to another browser).
export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof (w.SpeechRecognition || w.webkitSpeechRecognition) === 'function';
}
