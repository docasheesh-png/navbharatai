// U-7 (foundation) — API Keys management card.
//
// Lets a signed-in user create, view (metadata only), and revoke their public API keys. The plaintext
// key is shown exactly ONCE right after creation (the server never returns it again), with a copy button.
import { useCallback, useEffect, useState } from 'react';
import { Key, Trash2, Copy, Check, Plus, AlertTriangle } from 'lucide-react';

interface ApiKeyMeta {
  id: string;
  name: string;
  displayPrefix: string;
  last4: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

interface ApiKeysCardProps {
  /** Returns a fresh Firebase ID token, or null if not signed in. */
  getToken: () => Promise<string | null>;
}

export function ApiKeysCard({ getToken }: ApiKeysCardProps) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const authHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }, [getToken]);

  const fetchKeys = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const r = await fetch('/api/keys', { headers });
      if (r.ok) {
        const d = await r.json();
        setKeys(Array.isArray(d.keys) ? d.keys : []);
        setAvailableScopes(Array.isArray(d.availableScopes) ? d.availableScopes : []);
      }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const toggleScope = (s: string) =>
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const createKey = async () => {
    setError('');
    if (scopes.length === 0) { setError('Select at least one scope.'); return; }
    const headers = await authHeaders();
    if (!headers) return;
    setCreating(true);
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Untitled key', scopes }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'Could not create key.'); return; }
      setFreshKey(d.key);
      setName(''); setScopes([]);
      await fetchKeys();
    } catch {
      setError('Could not create key.');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const r = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (r.ok) await fetchKeys();
    } catch { /* non-fatal */ }
  };

  const copyFresh = async () => {
    if (!freshKey) return;
    try { await navigator.clipboard.writeText(freshKey); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-indigo-400" />
        <h2 className="text-xs font-black text-white uppercase tracking-widest">API Keys</h2>
        <span className="text-[10px] text-[#484f58] ml-auto">Programmatic access — see <a href="/guide" className="text-indigo-400">/guide</a></span>
      </div>

      {/* One-time reveal of a freshly created key */}
      {freshKey && (
        <div className="rounded-2xl p-3 border border-amber-500/30 bg-amber-500/10">
          <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black mb-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Copy this key now — it will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] text-white bg-black/40 rounded-lg px-3 py-2 font-mono break-all">{freshKey}</code>
            <button onClick={copyFresh} className="px-2 py-2 bg-indigo-600 rounded-lg text-white shrink-0" aria-label="Copy key">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={() => setFreshKey(null)} className="mt-2 text-[10px] text-[#8b949e] hover:text-white">I've saved it — dismiss</button>
        </div>
      )}

      {/* Create form */}
      <div className="bg-[#0d1117] rounded-2xl p-4 border border-white/5 space-y-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Key name (e.g. CI pipeline)"
          className="w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500"
        />
        <div className="flex flex-wrap gap-2">
          {availableScopes.map(s => (
            <button key={s} onClick={() => toggleScope(s)}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-full border transition-colors ${
                scopes.includes(s)
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-black/30 border-white/10 text-[#8b949e]'}`}>
              {s}
            </button>
          ))}
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <button onClick={createKey} disabled={creating}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> {creating ? 'Creating…' : 'Create key'}
        </button>
      </div>

      {/* Existing keys */}
      {loading ? (
        <p className="text-[11px] text-[#484f58]">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-[11px] text-[#484f58]">No API keys yet. Create one above to access the API programmatically.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className={`flex items-center gap-3 bg-[#0d1117] rounded-xl p-3 border border-white/5 ${k.revoked ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">
                  {k.name} {k.revoked && <span className="text-red-400 font-normal">(revoked)</span>}
                </div>
                <div className="text-[10px] text-[#8b949e] font-mono">{k.displayPrefix}…{k.last4} · {k.scopes.join(', ')}</div>
              </div>
              {!k.revoked && (
                <button onClick={() => revokeKey(k.id)} className="ml-auto p-1.5 text-[#8b949e] hover:text-red-400 shrink-0" aria-label="Revoke key">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
