import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw } from 'lucide-react';

/**
 * BOT LEDGER — every user's hosted chat bot, who built it, and whether it is signed (admin 2026-10-05:
 * "kis kis user ne bot banaye hai, uska bhi hisab admin panel me rakho!").
 *
 * Real data only: rows come from GET /api/admin/bots (admin token), twenty-five at a time, newest first,
 * with an opaque cursor. A list that could not be read says so — "no bots" over a failed read would tell
 * the admin the opposite of the truth. Never a token, never a secret: the server does not send them.
 *
 * The signed column exists because of Q-612: WhatsApp deliveries are verified with the owner's Meta App
 * Secret, and bots connected before that are served only until the cut-over date the server reports.
 */

const PAGE_SIZE = 25;

export interface BotLedgerRowView {
  botId: string;
  ownerUid: string;
  platform: 'telegram' | 'whatsapp';
  botUsername: string;
  createdAt: number;
  active: boolean;
  signed: boolean | null;
  unsignedSeenAt: number | null;
  lastWebhookAt: number | null;
  lastSignatureFailureAt: number | null;
  owner: { email: string; name: string; label: string; anonymous: boolean } | null;
}

interface Counts { total: number | null; whatsapp: number | null; telegram: number | null; whatsappSigned: number | null }

interface LedgerResponse {
  ok?: boolean;
  error?: string;
  rows?: BotLedgerRowView[];
  counts?: Counts | null;
  nextCursor?: string | null;
  whatsappSignatureRequiredAfter?: string;
}

export type AuthTone = 'ok' | 'warn' | 'bad';

/** How a row's incoming messages are authenticated, in words, with a tone. Pure. */
export function webhookAuthView(row: Pick<BotLedgerRowView, 'platform' | 'signed'>, cutoverMs: number, now: number): { label: string; tone: AuthTone; meaning: string } {
  if (row.platform === 'telegram') {
    return { label: 'Secret header', tone: 'ok', meaning: 'Telegram sends the secret NavBharatAI set when the bot was connected.' };
  }
  if (row.signed) {
    return { label: 'Signed', tone: 'ok', meaning: "Every message is checked against Meta's signature with the owner's App Secret." };
  }
  const past = cutoverMs > 0 && now >= cutoverMs;
  return past
    ? { label: 'Unsigned — refused', tone: 'bad', meaning: 'No App Secret on file and the cut-over date has passed, so its messages are refused until the owner adds one.' }
    : { label: 'Unsigned (legacy)', tone: 'warn', meaning: 'No App Secret on file. Served until the cut-over date; the owner sees a notice in the Bot Builder.' };
}

/** A count, or a dash when it could not be read — never a guessed zero. */
export function countText(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '—';
}

function fmtDate(ms: number | null | undefined): string {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
}

function fmtDateTime(ms: number | null | undefined): string {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

export interface BotsLedgerPanelProps {
  headers: Record<string, string>;
  openAccount: (uid: string) => void;
}

export const BotsLedgerPanel: React.FC<BotsLedgerPanelProps> = ({ headers, openAccount }) => {
  const [rows, setRows] = useState<BotLedgerRowView[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [cutoverMs, setCutoverMs] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const r = await fetch(`/api/admin/bots?${params.toString()}`, { headers });
      const d = (await r.json().catch(() => null)) as LedgerResponse | null;
      if (!r.ok || !d || d.ok === false || !Array.isArray(d.rows)) {
        if (!cursor) setRows(null);
        setError(d?.error || 'Could not read the bot list.');
        return;
      }
      setError('');
      const t = typeof d.whatsappSignatureRequiredAfter === 'string' ? Date.parse(d.whatsappSignatureRequiredAfter) : NaN;
      setCutoverMs(Number.isFinite(t) ? t : 0);
      setNextCursor(typeof d.nextCursor === 'string' && d.nextCursor ? d.nextCursor : null);
      if (cursor) {
        setRows(prev => {
          const seen = new Set((prev || []).map(x => x.botId));
          return [...(prev || []), ...d.rows!.filter(x => !seen.has(x.botId))];
        });
      } else {
        setRows(d.rows);
        setCounts(d.counts ?? null);
      }
    } catch (e) {
      console.error(e);
      if (!cursor) setRows(null);
      setError('Could not read the bot list.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers['x-admin-token']]);

  useEffect(() => { void load(null); }, [load]);

  const now = Date.now();
  const toneClass = (t: AuthTone) => (t === 'ok' ? 'text-success' : t === 'warn' ? 'text-warn' : 'text-danger');

  return (
    <div className="bg-card border border-line rounded-[1.5rem] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-sm font-black text-ink uppercase tracking-tight">
          <Bot size={15} className="text-info" /> Bots
        </h3>
        <button
          type="button"
          onClick={() => void load(null)}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <p className="text-[11px] text-muted">
        Every chat bot a user connected from the Bot Builder, newest first. WhatsApp bots without an App Secret are served until{' '}
        <span className="text-body font-bold">{fmtDate(cutoverMs) || 'the cut-over date'}</span> and refused after it.
      </p>
      {counts && (
        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
          <span className="px-2 py-1 rounded-full border border-line text-muted">All bots {countText(counts.total)}</span>
          <span className="px-2 py-1 rounded-full border border-line text-muted">WhatsApp {countText(counts.whatsapp)}</span>
          <span className="px-2 py-1 rounded-full border border-line text-muted">Telegram {countText(counts.telegram)}</span>
          <span className="px-2 py-1 rounded-full border border-line text-muted">WhatsApp signed {countText(counts.whatsappSigned)}</span>
        </div>
      )}
      {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
      {rows === null && !error && loading && <p className="text-[11px] text-muted">Loading…</p>}
      {Array.isArray(rows) && rows.length === 0 && !error && (
        <p className="text-[11px] text-muted">No user has connected a bot yet.</p>
      )}
      {Array.isArray(rows) && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(row => {
            const auth = webhookAuthView(row, cutoverMs, now);
            const ownerLabel = row.owner?.label || `id ${row.ownerUid.slice(0, 8)}`;
            return (
              <div key={row.botId} className="rounded-xl bg-well border border-line px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-line text-body">
                    {row.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                  </span>
                  <span className="text-[12px] font-bold text-ink truncate">
                    {row.botUsername ? (row.platform === 'telegram' ? `@${row.botUsername}` : row.botUsername) : 'Name not recorded'}
                  </span>
                  <span className={`text-[10px] font-black uppercase ${toneClass(auth.tone)}`} title={auth.meaning}>{auth.label}</span>
                  {!row.active && <span className="text-[10px] font-black uppercase text-muted">Inactive</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-faint">by</span>
                  <button type="button" onClick={() => openAccount(row.ownerUid)} className="text-[11px] text-body hover:text-ink underline decoration-dotted truncate max-w-full">
                    {ownerLabel}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-faint truncate mt-0.5">{row.botId}</p>
                <p className="text-[10px] text-muted mt-1 leading-relaxed">{auth.meaning}</p>
                <div className="flex items-center gap-2.5 mt-1 flex-wrap text-[10px] text-faint">
                  {row.createdAt > 0 && <span>connected {fmtDate(row.createdAt)}</span>}
                  {row.lastWebhookAt ? <span>last message {fmtDateTime(row.lastWebhookAt)}</span> : <span>no message recorded (tracked since 5 Oct 2026)</span>}
                  {row.unsignedSeenAt ? <span className="text-warn">unsigned traffic since {fmtDate(row.unsignedSeenAt)}</span> : null}
                  {row.lastSignatureFailureAt ? <span className="text-danger">bad signature refused {fmtDateTime(row.lastSignatureFailureAt)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {nextCursor && (
        <button
          type="button"
          onClick={() => void load(nextCursor)}
          disabled={loading}
          className="w-full py-2 rounded-xl bg-raised border border-line text-[11px] font-bold text-ink disabled:opacity-40"
        >
          {loading ? 'Loading…' : `Load ${PAGE_SIZE} more`}
        </button>
      )}
    </div>
  );
};
