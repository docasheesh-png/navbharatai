/**
 * ONE mic, wired the same way everywhere.
 *
 * There were four hand-written copies of "start the Web Speech API and turn its events into text",
 * and they had drifted into two behaviours — two correct, two carrying the duplicate-word bug the
 * admin reported on 2026-08-13 (see `lib/speechTranscript.ts` for the root cause). Four copies is
 * also why the fix could not simply be applied once: every new chat screen re-typed the logic and had
 * a fresh chance to get it wrong.
 *
 * This hook owns the parts that were being re-decided: the recogniser's settings, the language, the
 * accumulation, cleanup on unmount, and the guarantee that stopping really stops. The caller supplies
 * only what is genuinely its own — where the text goes.
 *
 * 🔒 CLEANUP IS NOT OPTIONAL. Three of the four copies left the recogniser running if the component
 * unmounted mid-dictation: the mic stays hot, the browser keeps showing a recording indicator, and on
 * a phone that is both a privacy surprise and a battery cost. The handlers are detached BEFORE stop()
 * so a final event cannot fire into a component that no longer exists.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { speechRecognitionSupported } from '../lib/voiceInput';
import {
  accumulateSpeech,
  emptyAccumulator,
  speechLang,
  transcriptText,
  type SpeechAccumulator,
} from '../lib/speechTranscript';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface UseSpeechInput {
  /** Whether this device exposes the Web Speech API at all. Gate the button's RENDER on this. */
  supported: boolean;
  listening: boolean;
  /** Begin dictation, appending to `base` (whatever the user has already typed). */
  start: (base: string) => void;
  stop: () => void;
  /** Start if idle, stop if listening — what a mic button actually needs. */
  toggle: (base: string) => void;
  /**
   * The committed and live halves, for a screen that shows them differently (Voice-to-App greys the
   * interim tail). Most callers want `onText` and can ignore these.
   */
  final: string;
  interim: string;
}

export interface SpeechInputOptions {
  /**
   * Force a recognition language, for a screen that lets the user PICK one (Voice-to-App offers
   * Hindi/English). Omitted, the device language is used — never a hardcoded 'en-IN', which is what
   * silently forced Hindi speech through an English recogniser on two screens.
   */
  lang?: string;
}

/**
 * @param onText Called with the full text the input should now show, on every update.
 */
export function useSpeechInput(onText: (text: string) => void, options: SpeechInputOptions = {}): UseSpeechInput {
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const accRef = useRef<SpeechAccumulator>(emptyAccumulator());
  const baseRef = useRef<string>('');
  // The callback is held in a ref so a caller that re-creates it every render (the normal case for an
  // inline arrow) does not need to be a dependency — a changed dependency here would tear down a
  // live recogniser mid-sentence.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const [supported] = useState(speechRecognitionSupported);
  const [listening, setListening] = useState(false);
  // Mirrored into state so a screen that renders the two halves separately re-renders on each event.
  const [parts, setParts] = useState<SpeechAccumulator>(emptyAccumulator);
  const langRef = useRef(options.lang);
  langRef.current = options.lang;

  /** Detach first, then stop — a late event must never reach a torn-down component. */
  const teardown = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try { rec.stop(); } catch { /* already stopped, or never started */ }
  }, []);

  const stop = useCallback(() => {
    teardown();
    setListening(false);
    // Drop the live tail: dictation is over, so an interim fragment left on screen would be text the
    // user can see but that no longer exists in the box. The COMMITTED text is kept -- every word
    // they actually said survives a dropped connection or a timeout.
    accRef.current = { final: accRef.current.final, interim: '' };
    setParts(accRef.current);
  }, [teardown]);

  const start = useCallback((base: string) => {
    if (recognitionRef.current) return;   // already dictating; a second recogniser would fight the first
    const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;   // unsupported platforms never render the button; this is a defensive no-op

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langRef.current || speechLang(typeof navigator !== 'undefined' ? navigator.language : null);

    accRef.current = emptyAccumulator();
    setParts(accRef.current);
    baseRef.current = base ?? '';

    rec.onresult = (event: unknown) => {
      accRef.current = accumulateSpeech(accRef.current, event as never);
      setParts(accRef.current);
      onTextRef.current(transcriptText(baseRef.current, accRef.current));
    };
    // An error and a natural end are the same thing to the UI: dictation is over. Neither discards
    // what was already transcribed — the user keeps every word they had said.
    rec.onerror = () => stop();
    rec.onend = () => stop();

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);   // start() throws if the mic is already in use elsewhere
    }
  }, [stop]);

  const toggle = useCallback((base: string) => {
    if (recognitionRef.current) stop(); else start(base);
  }, [start, stop]);

  // Leaving the screen mid-dictation must release the microphone.
  useEffect(() => teardown, [teardown]);

  return { supported, listening, start, stop, toggle, final: parts.final, interim: parts.interim };
}
