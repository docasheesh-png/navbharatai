import { useEffect, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import { authHeader } from '../../lib/authHeaders';
import type { MitrifyBotAccess } from '../../hooks/useMitrifyBot';

/** A stateless public-question conversation; displayed replies are never sent back. */
export function MitrifyChatPanel({ uid, access }: { uid: string; access: MitrifyBotAccess }) {
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => { if (user?.uid !== uid) pending.current?.abort(); });
    return () => { pending.current?.abort(); unsubscribe(); };
  }, [uid]);

  async function ask(question: MitrifyBotAccess['questions'][number]) {
    if (pending.current || !access.available || auth.currentUser?.uid !== uid) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    // Bound the local display as well; nothing is saved to account history.
    setMessages(items => [...items.slice(-18), { role: 'You', text: question.label }]);
    try {
      const headers = await authHeader();
      if (auth.currentUser?.uid !== uid) { controller.abort(); return; }
      const response = await fetch('/api/v1/chat/mitrify-bot', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id }), signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (controller.signal.aborted || auth.currentUser?.uid !== uid) return;
      if (!response.ok || typeof data.reply !== 'string') {
        setError('Mitrify could not answer. No other provider was used. Please try again later.'); return;
      }
      setMessages(items => [...items, { role: 'Mitrify', text: data.reply }]);
    } catch {
      if (!controller.signal.aborted) setError('The reply could not complete. No other provider was used.');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <section className="h-full overflow-y-auto bg-surface text-ink p-4 space-y-4" aria-label="Mitrify public chat">
    <h2 className="text-lg font-semibold">Mitrify chat</h2>
    <p className="text-sm text-muted">Choose a public question. This separate bot uses only Mitrify. Private messages, profile, files and previous chats are never sent. Free typing is unavailable.</p>
    {!access.available && <p role="status">Mitrify chat is not enabled or configured on the server yet.</p>}
    <div className="flex flex-wrap gap-2">{access.questions.map(question => <button key={question.id} type="button" disabled={busy || !access.available}
      className="rounded-lg border border-line px-3 py-2 disabled:opacity-50" onClick={() => void ask(question)}>{question.label}</button>)}</div>
    <div role="log" aria-live="polite" className="space-y-3">{messages.map((message, index) => <div key={index}><strong>{message.role}</strong><p className="whitespace-pre-wrap break-words">{message.text}</p></div>)}</div>
    {busy && <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setError('Reply stopped.'); }}>Stop reply</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
