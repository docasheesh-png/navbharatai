import type { TurnRunner } from './ClaudeClient';
import { voiceRequestedIn, voiceOf, type PlatformVoice } from './platformVoice';

export const replyVoiceForRequest = (text: string): PlatformVoice => voiceRequestedIn(text) ?? voiceOf(text);

/** The original user's conversation voice, NOT an internal English milestone/code brief. */
export function replyLanguageBinding(voice: PlatformVoice): string {
  const language = voice === 'hinglish' ? 'Roman-script Hinglish (Hindi in Latin letters, not Devanagari or English-only)'
    : voice === 'hindi' ? 'Hindi in Devanagari' : 'English';
  return `[USER REPLY LANGUAGE: ${language}] Write all user-facing narration, answers and roadmap JSON public fields (userMessage, achievableSummary, note, title, goal) in ${language}. Internal buildPrompt, source code, identifiers, paths and tool arguments keep their required language/format. An English internal milestone or repair brief is not a user language switch. This binds the conversation, not the app UI language.`;
}

export function bindReplyLanguage(system: string | undefined, voice: PlatformVoice): string {
  const binding = replyLanguageBinding(voice);
  return system?.endsWith(binding) ? system : `${system ?? ''}\n\n${binding}`;
}

/** Resolve per turn so an explicit live language switch applies to every subsequent lane. */
export function withReplyLanguage(runner: TurnRunner, voice: () => PlatformVoice): TurnRunner {
  return { ...runner, runTurn: (params) => runner.runTurn({ ...params,
    system: bindReplyLanguage(params.system, voice()),
  }) };
}
