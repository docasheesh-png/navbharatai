import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Trash2,
  Zap,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Languages,
  Info,
} from 'lucide-react';
import { speechRecognitionSupported } from '../../lib/voiceInput';

interface VoiceToAppProps {
  /**
   * Hands the spoken/edited prompt to the REAL build engine (NavBharatAI Pro v5.0): the app switches
   * to the Pro chat with the composer prefilled, and pressing Send starts a genuine live build.
   * This replaced a dead POST /api/generate call (the route never existed on the server, so the old
   * "Build My App" button always errored — a display-only feature, admin autopsy 2026-07-20).
   */
  onBuildViaV5: (prompt: string) => void;
}

const QUICK_PROMPTS = ['Todo App', 'Calculator', 'Quiz Game', 'Weather App', 'Restaurant Menu'];

const ENHANCERS = ['Make it mobile-first', 'Add animations', 'Dark mode', 'Include Firebase auth'];

const TIPS = [
  'Clearly say: what to build, what for, and how it should look',
  "Example: 'Build a restaurant menu app with 5 dishes'",
  'Details do: color, layout, features',
  'Mix languages — Hinglish is perfectly fine',
  'Jitna specific utna better result',
];

export const VoiceToApp: React.FC<VoiceToAppProps> = ({ onBuildViaV5 }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [editablePrompt, setEditablePrompt] = useState('');
  const [lang, setLang] = useState<'hi-IN' | 'en-US'>('hi-IN');
  const [activeEnhancers, setActiveEnhancers] = useState<string[]>([]);
  const [enhancersOpen, setEnhancersOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [speechSupported] = useState(speechRecognitionSupported);

  const recognitionRef = useRef<any>(null);

  const buildFullPrompt = useCallback(() => {
    const base = editablePrompt.trim();
    if (!base) return '';
    if (activeEnhancers.length === 0) return base;
    return `${base}\n\nRequirements: ${activeEnhancers.join(', ')}.`;
  }, [editablePrompt, activeEnhancers]);

  useEffect(() => {
    if (!speechSupported) return;
    const SRClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const sr = new SRClass();
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = lang;

    sr.onresult = (event: any) => {
      let interim = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript: string = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += transcript;
        } else {
          interim += transcript;
        }
      }
      if (newFinal) {
        setFinalText((prev) => {
          const updated = prev + (prev ? ' ' : '') + newFinal.trim();
          setEditablePrompt(updated);
          return updated;
        });
      }
      setInterimText(interim);
    };

    sr.onerror = () => {
      setIsRecording(false);
      setInterimText('');
    };

    sr.onend = () => {
      setIsRecording(false);
      setInterimText('');
    };

    recognitionRef.current = sr;

    return () => {
      sr.onresult = null;
      sr.onerror = null;
      sr.onend = null;
      if (isRecording) {
        try { sr.stop(); } catch (_) {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechSupported, lang]);

  const toggleRecording = () => {
    if (!speechSupported) return;
    const sr = recognitionRef.current;
    if (!sr) return;
    if (isRecording) {
      sr.stop();
      setIsRecording(false);
    } else {
      setInterimText('');
      try {
        sr.start();
        setIsRecording(true);
      } catch (_) {
        setIsRecording(false);
      }
    }
  };

  const clearTranscript = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
    setFinalText('');
    setInterimText('');
    setEditablePrompt('');
    setStatus('idle');
    setErrorMsg('');
  };

  const applyQuickPrompt = (qp: string) => {
    const val = editablePrompt.trim() ? `${editablePrompt.trim()} — ${qp}` : qp;
    setEditablePrompt(val);
    setFinalText(val);
  };

  const toggleEnhancer = (e: string) => {
    setActiveEnhancers((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]
    );
  };

  const handleGenerate = () => {
    const prompt = buildFullPrompt();
    if (!prompt) return;
    // Stop the mic before leaving this view, then hand the prompt to the real engine.
    if (isRecording) {
      try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
      setIsRecording(false);
    }
    setStatus('success');
    setErrorMsg('');
    onBuildViaV5(prompt);
  };

  const charCount = editablePrompt.length;

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#0d1117] text-gray-300 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Mic className="w-6 h-6 text-indigo-400" />
            Voice to App
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Just speak — NavBharatAI Pro v5.0 will build your app
          </p>
        </div>

        {!speechSupported && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-yellow-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Speech recognition is not supported in this browser. Type your prompt below.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="rounded-xl border border-white/10 bg-[#161b22] p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-400">Voice Recorder</span>
                <button
                  onClick={() => setLang((l) => (l === 'hi-IN' ? 'en-US' : 'hi-IN'))}
                  className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition-colors"
                >
                  <Languages className="w-3.5 h-3.5" />
                  {lang === 'hi-IN' ? 'Hindi' : 'English'}
                </button>
              </div>

              <div className="flex flex-col items-center gap-5 py-4">
                <button
                  onClick={toggleRecording}
                  disabled={!speechSupported}
                  className={[
                    'relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none',
                    isRecording
                      ? 'bg-red-600 shadow-lg shadow-red-600/40'
                      : 'bg-white/10 hover:bg-white/20',
                    !speechSupported ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                  ].join(' ')}
                >
                  {isRecording && (
                    <span className="absolute inset-0 rounded-full bg-red-600 animate-ping opacity-40" />
                  )}
                  {isRecording ? (
                    <MicOff className="w-8 h-8 text-white relative z-10" />
                  ) : (
                    <Mic className="w-8 h-8 text-gray-300 relative z-10" />
                  )}
                </button>

                <p className="text-xs text-gray-500">
                  {isRecording ? 'Recording… click to stop' : 'Click to start speaking'}
                </p>
              </div>

              {(finalText || interimText) && (
                <div className="mt-2 rounded-lg border border-white/10 bg-[#0d1117] p-3 min-h-[60px] text-sm leading-relaxed">
                  {finalText && <span className="text-white">{finalText}</span>}
                  {interimText && (
                    <span className="text-gray-400 italic">
                      {finalText ? ' ' : ''}
                      {interimText}
                    </span>
                  )}
                </div>
              )}

              {(finalText || interimText) && (
                <button
                  onClick={clearTranscript}
                  className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#161b22] p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">App Description</span>
                <span className="text-xs text-gray-600">{charCount} chars</span>
              </div>

              <textarea
                value={editablePrompt}
                onChange={(e) => setEditablePrompt(e.target.value)}
                placeholder="Describe your app… or speak using the mic above"
                rows={5}
                className="w-full resize-none rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-colors"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((qp) => (
                  <button
                    key={qp}
                    onClick={() => applyQuickPrompt(qp)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300 hover:bg-indigo-500/20 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
                  >
                    {qp}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-white/10 overflow-hidden">
                <button
                  onClick={() => setEnhancersOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-white/5 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                >
                  <span>Prompt Enhancers</span>
                  {enhancersOpen ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {enhancersOpen && (
                  <div className="px-4 py-3 flex flex-wrap gap-2">
                    {ENHANCERS.map((e) => (
                      <button
                        key={e}
                        onClick={() => toggleEnhancer(e)}
                        className={[
                          'rounded-full border px-3 py-1 text-xs transition-colors',
                          activeEnhancers.includes(e)
                            ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-300'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:border-indigo-500/30 hover:text-gray-300',
                        ].join(' ')}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleGenerate}
                disabled={!editablePrompt.trim()}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/30 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                <Zap className="w-4 h-4" />
                Build My App
              </button>

              {status === 'success' && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-green-400 text-sm">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  Your prompt is ready in Pro v5.0 chat — press Send to start the real build
                </div>
              )}

              {status === 'error' && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-white/10 bg-[#161b22] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-gray-300">Pro Tips</span>
              </div>
              <ul className="flex flex-col gap-3">
                {TIPS.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
                    <span className="mt-0.5 w-4 h-4 flex-shrink-0 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                      {i + 1}
                    </span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {activeEnhancers.length > 0 && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                <p className="text-xs text-indigo-400 font-medium mb-2">Active Enhancers</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeEnhancers.map((e) => (
                    <span
                      key={e}
                      className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs text-indigo-300"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
