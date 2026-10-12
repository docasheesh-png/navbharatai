import React, { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, LogOut } from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';
import type { OwnerBot } from './WhatsAppAppSecretNotice';
import { readOwnerBots, botLabel, disconnectedLine, disconnectConfirmText } from '../../lib/connectedBots';

/**
 * YOUR BOTS (Q-816). Every bot this account has live, with a Disconnect button that calls the real route and says
 * what it really did. Real data only: the list is GET /api/bots, the disconnect is POST /api/bots/disconnect.
 * Hidden when signed out or when there are no bots; a list that could not be read says so instead of "none".
 */
export const ConnectedBotsView: React.FC<{
  bots: OwnerBot[] | null;
  failed: boolean;
  open: boolean;
  busyId: string;
  notes: Record<string, string>;
  onToggle: () => void;
  onDisconnect: (bot: OwnerBot) => void;
}> = ({ bots, failed, open, busyId, notes, onToggle, onDisconnect }) => {
  const done = Object.values(notes).filter(Boolean);
  if (failed) {
    return <div className="px-3 py-2 border-b border-line bg-card text-xs text-muted" role="status">Could not read your connected bots just now — reopen Bot Builder to try again.</div>;
  }
  if (!bots || (bots.length === 0 && done.length === 0)) return null;
  return (
    <div className="border-b border-line bg-card" role="region" aria-label="Your connected bots">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-body touch-manipulation">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Bot size={13} />
        <span className="font-semibold">Your bots</span>
        <span className="text-muted">· {bots.length} connected</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 px-3 pb-3">
          {bots.map((bot) => (
            <li key={bot.botId} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-raised px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink truncate">{botLabel(bot)}</p>
                <p className="text-[11px] text-muted">{bot.platform === 'telegram' ? 'Telegram' : 'WhatsApp'} · connected {new Date(bot.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
              </div>
              <button
                type="button"
                onClick={() => onDisconnect(bot)}
                disabled={busyId === bot.botId}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-danger border border-line disabled:opacity-40 whitespace-nowrap touch-manipulation"
              >
                <LogOut size={12} /> {busyId === bot.botId ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </li>
          ))}
          {bots.length === 0 && <li className="text-xs text-muted">No bots are connected now.</li>}
          {done.map((line, i) => <li key={i} className="text-xs text-body" role="status">{line}</li>)}
        </ul>
      )}
    </div>
  );
};

export const ConnectedBotsPanel: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const [bots, setBots] = useState<OwnerBot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const headers = await authJsonHeaders();
      if (!headers.Authorization) { setBots(null); setFailed(false); return; }
      const res = await fetch('/api/bots', { headers });
      const list = readOwnerBots(res.ok, await res.json().catch(() => null));
      setBots(list);
      setFailed(list === null);
    } catch {
      setBots(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const onDisconnect = useCallback(async (bot: OwnerBot) => {
    if (typeof window !== 'undefined' && !window.confirm(disconnectConfirmText(bot))) return;
    setBusyId(bot.botId);
    try {
      const res = await fetch('/api/bots/disconnect', { method: 'POST', headers: await authJsonHeaders(), body: JSON.stringify({ botId: bot.botId }) });
      const body = await res.json().catch(() => null);
      const line = res.ok
        ? disconnectedLine(bot, body)
        : (body && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'Could not disconnect it just now — please try again.');
      setNotes((n) => ({ ...n, [bot.botId]: line }));
      if (res.ok) await load();
    } catch {
      setNotes((n) => ({ ...n, [bot.botId]: 'Network error — the bot was not disconnected. Please try again.' }));
    } finally {
      setBusyId('');
    }
  }, [load]);

  return <ConnectedBotsView bots={bots} failed={failed} open={open} busyId={busyId} notes={notes} onToggle={() => setOpen((o) => !o)} onDisconnect={(b) => void onDisconnect(b)} />;
};
