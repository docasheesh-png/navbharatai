import { useEffect, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import { authHeader } from '../../lib/authHeaders';
import { mitrifyBotError } from '../../lib/mitrifyBotError';
import type { MitrifyBotAccess } from '../../hooks/useMitrifyBot';

/** Keep the complete returned text, with a separate accessible completion warning. */
export function MitrifyReply({ text, completion }: { text: string; completion?: unknown }) {
  const notice = completion === 'complete' ? null
    : completion === 'length' ? 'This reply reached its length limit and is incomplete. You can ask a narrower question; no continuation was sent automatically.'
    : completion === 'filtered' ? 'This reply was stopped by a content filter and may be incomplete.'
    : 'Mitrify did not confirm that this reply completed. It may be incomplete.';
  return <><p className="whitespace-pre-wrap break-words">{text}</p>{notice && <p role="status" className="text-sm text-muted">{notice}</p>}</>;
}

type ContinuationOffer = { available: true; ticket: string; instruction: string; roundsRemaining: number };
export function continuationOffer(value: unknown): ContinuationOffer | null {
  const v = value as Partial<ContinuationOffer> | null;
  return v?.available === true && typeof v.ticket === 'string' && /^[a-f0-9-]{36}$/.test(v.ticket)
    && typeof v.instruction === 'string' && v.instruction.length <= 500 && Number.isInteger(v.roundsRemaining)
    && v.roundsRemaining! >= 1 && v.roundsRemaining! <= 3 ? v as ContinuationOffer : null;
}
export function MitrifyContinuationReview({ prompt, answer, offer, onConfirm, onCancel }: {
  prompt: string; answer: string; offer: ContinuationOffer; onConfirm: () => void; onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return <form aria-label="Review continuation context" className="space-y-3 rounded-lg border border-line p-3"
    onSubmit={event => { event.preventDefault(); if (confirmed) onConfirm(); }}>
    <p>These exact messages will be sent to Mitrify and its providers. This is another request and may use gateway credits. No files, profile or unrelated history are included.</p>
    <strong>Original prompt</strong><p className="whitespace-pre-wrap break-words">{prompt}</p>
    <strong>Accumulated answer</strong><p className="whitespace-pre-wrap break-words">{answer}</p>
    <strong>Continuation instruction</strong><p className="whitespace-pre-wrap break-words">{offer.instruction}</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      I reviewed all text above, including the generated answer. It contains no health, personal, payment or other sensitive information and may be resent.</label>
    <p className="text-sm text-muted">At most {offer.roundsRemaining} more continuation requests remain. A complete answer is not guaranteed.</p>
    <button type="submit" disabled={!confirmed} className="rounded-lg border border-line px-3 py-2 disabled:opacity-50">Send reviewed continuation</button>
    <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={onCancel}>Cancel review</button>
  </form>;
}
export function continuationUnavailable(value: unknown): string {
  const reason = value && typeof value === 'object' && 'reason' in value ? value.reason : undefined;
  return reason === 'context-limit' ? 'The full accumulated context exceeds the continuation limit. Nothing was trimmed.'
    : reason === 'round-limit' ? 'The continuation round limit was reached. Your partial answer is kept.'
    : reason === 'used' ? 'This continuation was submitted or stopped and will not be replayed. Your partial answer is kept.'
    : reason === 'expired' ? 'This continuation has expired. Your partial answer is kept.'
    : 'Continuation is unavailable until its spending limit and admission are verified. Your partial answer is kept.';
}

/** New messages never include history. Continuations require separate exact-context review. */
export function MitrifyChatPanel({ uid, access }: { uid: string; access: MitrifyBotAccess }) {
  const [messages, setMessages] = useState<Array<{ id?: number; role: string; text: string; completion?: unknown; prompt?: string; continuation?: unknown; attemptTicket?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const nextMessage = useRef(0);
  const [reviewId, setReviewId] = useState<number | null>(null);
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => { if (user?.uid !== uid) pending.current?.abort(); });
    return () => { pending.current?.abort(); unsubscribe(); };
  }, [uid]);

  async function ask() {
    if (pending.current || !access.available || !confirmed || !input.trim() || input.length > 2000 || auth.currentUser?.uid !== uid) return;
    const message = input;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(''); setReviewId(null);
    setConfirmed(false);
    // Bound the local display as well; nothing is saved to account history.
    setMessages(items => [...items.slice(-18), { role: 'You', text: message }]);
    try {
      const headers = await authHeader();
      if (auth.currentUser?.uid !== uid) { controller.abort(); return; }
      const response = await fetch('/api/v1/chat/mitrify-bot', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, publicContentConfirmed: true }), signal: controller.signal, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted || auth.currentUser?.uid !== uid) return;
      if (!response.ok || typeof data?.reply !== 'string') {
        setError(mitrifyBotError(response.status, data)); return;
      }
      const id = nextMessage.current++;
      setMessages(items => [...items, { id, role: 'Mitrify', text: data.reply, completion: data.completion, prompt: message, continuation: data.continuation }]);
      setInput('');
    } catch {
      if (!controller.signal.aborted) setError('The reply could not complete. No other provider was used.');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  async function continueReply(id: number) {
    const message = messages.find(item => item.id === id && item.role === 'Mitrify');
    const offer = continuationOffer(message?.continuation);
    if (pending.current || !access.available || auth.currentUser?.uid !== uid || !message?.prompt || message.completion !== 'length' || !offer || reviewId !== id) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(''); setReviewId(null);
    // Consume the local offer before awaiting anything. Failed/aborted calls never replay it.
    setMessages(items => items.map(item => item.id === id ? { ...item, continuation: { available: false, reason: 'used' }, attemptTicket: offer.ticket } : item));
    try {
      const headers = await authHeader();
      if (controller.signal.aborted || auth.currentUser?.uid !== uid) { controller.abort(); return; }
      const response = await fetch('/api/v1/chat/mitrify-bot/continue', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: offer.ticket, prompt: message.prompt, answer: message.text,
          reviewedInstruction: offer.instruction, publicContentConfirmed: true }), signal: controller.signal, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted || auth.currentUser?.uid !== uid) return;
      if (!response.ok || typeof data?.reply !== 'string' || !data.reply.trim()) { setError(mitrifyBotError(response.status, data)); return; }
      setMessages(items => items.map(item => item.id === id && item.attemptTicket === offer.ticket && item.text === message.text
        ? { ...item, text: item.text + '\n\n' + data.reply, completion: data.completion, continuation: data.continuation, attemptTicket: undefined } : item));
    } catch {
      if (!controller.signal.aborted) setError('Continuation could not complete. Your partial answer is kept. No automatic retry will run.');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  const review = messages.find(item => item.id === reviewId && item.role === 'Mitrify');
  const reviewOffer = continuationOffer(review?.continuation);

  return <section className="h-full overflow-y-auto bg-surface text-ink p-4 space-y-4" aria-label="Mitrify public chat">
    <h2 className="text-lg font-semibold">Mitrify chat</h2>
    <p id="mitrify-privacy" className="text-sm text-muted">Use only public, non-sensitive text. Your full message goes to Mitrify and its upstream providers, who may log it. Do not include health records, personal identifiers, payment details, passwords or other sensitive information. Automatic checks can miss sensitive content. New messages do not include profile, files or previous messages. A continuation resends only the context you separately review.</p>
    {!access.available && <p role="status">Mitrify chat is not enabled or configured on the server yet.</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <label className="block" htmlFor="mitrify-message">Your message</label>
      <textarea id="mitrify-message" aria-describedby="mitrify-privacy" value={input} maxLength={2000} rows={4} disabled={busy || !access.available}
        className="w-full rounded-lg border border-line bg-surface p-3 text-ink" onChange={event => { setInput(event.target.value); setConfirmed(false); }} />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !access.available}
        onChange={event => setConfirmed(event.target.checked)} />I confirm this message contains no sensitive or personal information.</label>
      <button type="submit" disabled={busy || !access.available || !confirmed || !input.trim()} className="rounded-lg border border-line px-3 py-2 disabled:opacity-50">Send</button>
    </form>
    <div role="log" aria-live="polite" className="space-y-3">{messages.map((message, index) => <div key={index}><strong>{message.role}</strong><MitrifyReply text={message.text} completion={message.role === 'Mitrify' ? message.completion : 'complete'} />
      {message.role === 'Mitrify' && message.completion === 'length' && <div>
        <button type="button" disabled={busy || !continuationOffer(message.continuation)} className="rounded-lg border border-line px-3 py-2 disabled:opacity-50" onClick={() => setReviewId(message.id ?? null)}>Review and continue</button>
        {!continuationOffer(message.continuation) && <p role="status" className="text-sm text-muted">{continuationUnavailable(message.continuation)}</p>}
      </div>}</div>)}</div>
    {!busy && review?.prompt && reviewOffer && <MitrifyContinuationReview key={reviewOffer.ticket} prompt={review.prompt} answer={review.text} offer={reviewOffer}
      onConfirm={() => { void continueReply(review.id!); }} onCancel={() => setReviewId(null)} />}
    {busy && <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setError('Reply stopped.'); }}>Stop reply</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
