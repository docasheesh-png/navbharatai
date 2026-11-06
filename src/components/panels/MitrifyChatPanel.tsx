import { useEffect, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import { authHeader } from '../../lib/authHeaders';
import { mitrifyBotError } from '../../lib/mitrifyBotError';
import type { MitrifyBotAccess } from '../../hooks/useMitrifyBot';

/** One user-reviewed public message at a time; displayed replies are never sent back. */
export function MitrifyChatPanel({ uid, access }: { uid: string; access: MitrifyBotAccess }) {
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => { if (user?.uid !== uid) pending.current?.abort(); });
    return () => { pending.current?.abort(); unsubscribe(); };
  }, [uid]);

  async function ask() {
    if (pending.current || !access.available || !confirmed || !input.trim() || input.length > 2000 || auth.currentUser?.uid !== uid) return;
    const message = input;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
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
      setMessages(items => [...items, { role: 'Mitrify', text: data.reply }]);
      setInput('');
    } catch {
      if (!controller.signal.aborted) setError('The reply could not complete. No other provider was used.');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <section className="h-full overflow-y-auto bg-surface text-ink p-4 space-y-4" aria-label="Mitrify public chat">
    <h2 className="text-lg font-semibold">Mitrify chat</h2>
    <p id="mitrify-privacy" className="text-sm text-muted">Use only public, non-sensitive text. Your full message goes to Mitrify and its upstream providers, who may log it. Do not include health records, personal identifiers, payment details, passwords or other sensitive information. Automatic checks can miss sensitive content. Profile, files and previous messages are not included.</p>
    {!access.available && <p role="status">Mitrify chat is not enabled or configured on the server yet.</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <label className="block" htmlFor="mitrify-message">Your message</label>
      <textarea id="mitrify-message" aria-describedby="mitrify-privacy" value={input} maxLength={2000} rows={4} disabled={busy || !access.available}
        className="w-full rounded-lg border border-line bg-surface p-3 text-ink" onChange={event => { setInput(event.target.value); setConfirmed(false); }} />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !access.available}
        onChange={event => setConfirmed(event.target.checked)} />I reviewed this message: it contains no health, personal, payment or other sensitive information, and may be sent to Mitrify and its providers.</label>
      <button type="submit" disabled={busy || !access.available || !confirmed || !input.trim()} className="rounded-lg border border-line px-3 py-2 disabled:opacity-50">Send</button>
    </form>
    <div role="log" aria-live="polite" className="space-y-3">{messages.map((message, index) => <div key={index}><strong>{message.role}</strong><p className="whitespace-pre-wrap break-words">{message.text}</p></div>)}</div>
    {busy && <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setError('Reply stopped.'); }}>Stop reply</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
