import { chatReplyLanguageCategory, resolveChatReplyLanguage } from '../../lib/chatReplyLanguage';
import { detectReplyLanguage } from './freeChatReplies';

const HINGLISH_WORDS = /\b(hai|hain|ho|kya|kaise|kaisa|kab|kyu|kyun|mujhe|mera|meri|mere|hum|aap|tum|ek|ke|ki|ka|ko|me|mein|se|par|aur|bhi|nahi|nhi|karo|kar|kardo|karna|banao|bana|banado|banana|chahiye|batao|bataiye|bare|baare|wala|wali|liye|accha|acha|bhai|yaar|ji)\b/gi;

function counts(text: string): { deva: number; latin: number } {
  return { deva: (text.match(/[\u0900-\u097F]/g) ?? []).length, latin: (text.match(/[A-Za-z]/g) ?? []).length };
}

/** Hindi probe answers must use Devanagari. English probe answers must use Latin and not Devanagari. */
export function qubaxProbeScriptOk(answer: string, language: 'hi' | 'en'): boolean {
  const { deva, latin } = counts(answer);
  if (language === 'hi') return deva >= 2;
  return deva === 0 && latin >= 3;
}

/**
 * Cheap script check. A short language-neutral reply (a number, a name) is kept.
 * Devanagari in, Devanagari out. Roman Hindi or English in, Roman out.
 * A long English paragraph does not count as Hinglish.
 */
export function qubaxReplyMatchesUser(messages: { role?: string; content?: string }[], reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  const users = messages.filter(message => message?.role === 'user' && typeof message.content === 'string').map(message => message.content as string);
  const last = users.at(-1) ?? '';
  const explicit = resolveChatReplyLanguage(last, users.slice(0, -1).map(content => ({ sender: 'user', text: content })));
  const want = explicit ? chatReplyLanguageCategory(explicit) : detectReplyLanguage(last);
  const { deva, latin } = counts(text);
  if (deva + latin < 3) return true;
  if (want === 'hi') return deva >= 2 && deva * 2 >= latin;
  if (want !== 'hinglish' && want !== 'en') return true;
  if (latin < 2 || latin * 2 < deva) return false;
  if (want === 'hinglish') {
    const words = (text.match(/[A-Za-z]+/g) ?? []).length;
    const hits = (text.match(HINGLISH_WORDS) ?? []).length;
    if (words >= 8 && hits === 0) return false;
  }
  return true;
}
