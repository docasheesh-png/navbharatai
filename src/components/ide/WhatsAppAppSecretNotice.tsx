import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink } from 'lucide-react';
import { auth } from '../../lib/firebase';

/**
 * THE APP SECRET NOTICE (Q-612, admin decision 2026-10-05).
 *
 * Meta signs every WhatsApp delivery with the owner's App Secret, and since 2026-10-05 the server checks
 * that signature before a flow runs. Bots connected before then have no App Secret on file: they keep
 * working until the cut-over date the server reports, then their messages are refused. This strip tells
 * the owner exactly that — what the secret is, where Meta shows it, and the real date — and lets them add
 * it in place, without reconnecting (a reconnect would change the bot's webhook URL in Meta).
 *
 * It also shows a signed bot whose last delivery FAILED the check: that is almost always a secret from a
 * different Meta app, and without this line the owner would only see a bot that went quiet.
 *
 * Real data only: the list and the date come from GET /api/bots; the save is POST /api/bots/whatsapp/app-secret.
 * Nothing is shown when the owner has no bot that needs attention, or is signed out.
 */

export interface OwnerBot {
  botId: string;
  platform: 'telegram' | 'whatsapp';
  botUsername: string;
  createdAt: number;
  active: boolean;
  signed: boolean | null;
  lastSignatureFailureAt: number | null;
}

export type AppSecretNeed = 'missing' | 'mismatch' | null;

/** What a bot needs from its owner, if anything. Pure. */
export function appSecretNeed(bot: Pick<OwnerBot, 'platform' | 'signed' | 'lastSignatureFailureAt'>): AppSecretNeed {
  if (bot.platform !== 'whatsapp') return null;
  if (bot.signed === false) return 'missing';
  if (bot.signed === true && typeof bot.lastSignatureFailureAt === 'number' && bot.lastSignatureFailureAt > 0) return 'mismatch';
  return null;
}

/** Same shape check the server applies, so a paste mistake is caught before the round trip. */
export function looksLikeAppSecret(v: string): boolean {
  return /^[0-9a-f]{32}$/i.test(v.trim());
}

function fmtDate(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const tok = await auth.currentUser?.getIdToken().catch(() => undefined);
  return tok ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` } : null;
}

export const WhatsAppAppSecretNotice: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const [bots, setBots] = useState<OwnerBot[]>([]);
  const [cutoverMs, setCutoverMs] = useState<number>(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) { setBots([]); return; }
      const res = await fetch('/api/bots', { headers });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { bots?: unknown; whatsappSignatureRequiredAfter?: unknown } | null;
      if (!data || !Array.isArray(data.bots)) return;
      setBots(data.bots as OwnerBot[]);
      const t = typeof data.whatsappSignatureRequiredAfter === 'string' ? Date.parse(data.whatsappSignatureRequiredAfter) : NaN;
      setCutoverMs(Number.isFinite(t) ? t : 0);
    } catch { /* a notice that cannot load stays hidden; the bot itself is unaffected */ }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const save = useCallback(async (botId: string) => {
    const value = (drafts[botId] || '').trim();
    if (!looksLikeAppSecret(value)) {
      setErrors(e => ({ ...e, [botId]: 'That is not an App Secret. In Meta: App settings → Basic → App secret → Show. It is 32 letters and digits.' }));
      return;
    }
    setBusy(botId); setErrors(e => ({ ...e, [botId]: '' }));
    try {
      const headers = await authHeaders();
      if (!headers) { setErrors(e => ({ ...e, [botId]: 'Please sign in first.' })); return; }
      const res = await fetch('/api/bots/whatsapp/app-secret', { method: 'POST', headers, body: JSON.stringify({ botId, appSecret: value }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setErrors(e => ({ ...e, [botId]: data.error || 'Could not save the App Secret.' })); return; }
      setDrafts(d => ({ ...d, [botId]: '' }));
      setSaved(botId);
      await load();
    } catch {
      setErrors(e => ({ ...e, [botId]: 'Network error — please try again.' }));
    } finally {
      setBusy('');
    }
  }, [drafts, load]);

  const needy = bots.filter(b => appSecretNeed(b) !== null);
  if (needy.length === 0) {
    return saved ? (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-xs text-success bg-card" role="status">
        <Check size={13} /> App Secret saved. Every message to this bot is now checked against Meta's signature.
      </div>
    ) : null;
  }

  const past = cutoverMs > 0 && Date.now() >= cutoverMs;
  const date = fmtDate(cutoverMs);

  return (
    <div className="flex flex-col gap-3 px-3 py-3 border-b border-line bg-card max-h-[45vh] overflow-y-auto" role="region" aria-label="WhatsApp bots that need attention">
      {needy.map(bot => {
        const need = appSecretNeed(bot);
        return (
          <div key={bot.botId} className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-warn">
              <AlertTriangle size={14} />
              {need === 'missing'
                ? `Your WhatsApp bot (${bot.botUsername || bot.botId}) needs its App Secret`
                : `Your WhatsApp bot (${bot.botUsername || bot.botId}) refused a message on ${fmtDate(bot.lastSignatureFailureAt || 0)}`}
            </div>
            {need === 'missing' ? (
              <p className="text-xs text-body">
                Meta signs every message it sends to your bot with your app&apos;s App Secret. Without it on file, NavBharatAI cannot tell a real WhatsApp
                message from a forged one, so anyone who learns this bot&apos;s webhook address could make it send messages from your business number.{' '}
                {past
                  ? <span className="text-danger font-semibold">Since {date}, messages to this bot are refused and it does not reply. Add the App Secret below and it replies again at once.</span>
                  : <span className="font-semibold">Add it before {date || 'the cut-over date'}. After that date, messages to a bot without an App Secret are refused and the bot stops replying.</span>}
              </p>
            ) : (
              <p className="text-xs text-body">
                That message did not match the App Secret on file, so nothing ran and nothing was sent. If your bot has stopped replying, the App Secret
                is probably from a different Meta app — paste the one from the app that owns this phone number. If it still replies, someone sent a
                forged message and it was blocked.
              </p>
            )}
            <p className="text-[11px] text-muted">
              Where to find it: open your app on developers.facebook.com → App settings → Basic → App secret → Show.
            </p>
            <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-[11px] text-accent-text flex items-center gap-1 self-start">
              <ExternalLink size={11} /> Open the Meta App Dashboard
            </a>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={drafts[bot.botId] || ''}
                onChange={e => setDrafts(d => ({ ...d, [bot.botId]: e.target.value }))}
                placeholder="Meta App Secret"
                aria-label={`App Secret for ${bot.botUsername || bot.botId}`}
                className="flex-1 min-w-0 rounded-lg p-2 text-xs text-body border border-line font-mono bg-surface focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void save(bot.botId)}
                disabled={busy === bot.botId || !(drafts[bot.botId] || '').trim()}
                className="px-3 rounded-lg text-xs bg-accent text-on-accent disabled:opacity-40 whitespace-nowrap"
              >
                {busy === bot.botId ? 'Saving…' : 'Save App Secret'}
              </button>
            </div>
            {errors[bot.botId] && <p className="text-xs text-danger">{errors[bot.botId]}</p>}
          </div>
        );
      })}
    </div>
  );
};
