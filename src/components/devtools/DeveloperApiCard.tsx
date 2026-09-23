// DEVELOPER TOOLS → NAVBHARATAI API — the one screen where a user makes, controls and tests a key.
//
// 🔴 WHY IT MOVED HERE (admin 2026-09-17). The API Keys card sat at the bottom of My Profile, where a
// non-technical user meets it first and a developer never looks for it; two of its three scopes were
// tickable and did nothing. The admin's brief: *"developer tools ke andar yeh pura system bana kar
// dalo — system working hona chahiye, api keys farzi nahi ho — aur user is api se kya kya share karna
// chahta hai, woh bhi control kar sake."*
//
// So this screen is built around three promises the server actually keeps (see lib/developerApi.ts):
//   • every scope the user can tick opens a real door — the list says which endpoint each one is;
//   • every key carries a daily ₹ limit the user sets, so a leaked key cannot empty a wallet;
//   • a freshly made key can be TESTED right here, against the live API, before the secret is dismissed.
//
// Language rule: all UI text is English. The plaintext key is shown exactly once.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Key, Trash2, Copy, Check, Plus, AlertTriangle, ShieldCheck, Play, Pencil, Code2, LogIn } from 'lucide-react';
import { authHeader } from '../../lib/authHeaders';
import { usePagedList } from '../../hooks/usePagedList';
import { LoadMore } from '../common/LoadMore';

interface ApiKeyMeta {
  id: string;
  name: string;
  displayPrefix: string;
  last4: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
  dailyCapInr: number;
  /** null = not measured right now (never a confident zero). */
  todaySpentInr: number | null;
  todayCalls: number | null;
}

interface ScopeDescription { title: string; detail: string }
interface ScopeRoute { method: 'GET' | 'POST'; path: string }

interface KeysPayload {
  keys: ApiKeyMeta[];
  availableScopes: string[];
  scopeDescriptions: Record<string, ScopeDescription>;
  scopeRoutes: Record<string, ScopeRoute>;
  dailyCap: { default: number; max: number };
}

interface DeveloperApiCardProps {
  /** Signed-in user, or null. The card explains itself to a signed-out visitor and asks them to sign in. */
  signedIn: boolean;
  onShowLogin?: () => void;
}

/** The one scope that means every scope — matched by name, the same word the server uses. */
const FULL_ACCESS = 'all';

/** The API's public base — the origin the page is served from, so the snippet is right on every deploy. */
function apiBase(): string {
  try { return `${window.location.origin}/api/v1`; } catch { return 'https://navbharatai.com/api/v1'; }
}

function when(ms: number | null): string {
  if (!ms) return 'never';
  try { return new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; }
}

export function DeveloperApiCard({ signedIn, onShowLogin }: DeveloperApiCardProps) {
  const [payload, setPayload] = useState<KeysPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read:profile']);
  const [capInr, setCapInr] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const [freshKey, setFreshKey] = useState<{ key: string; id: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [editingCap, setEditingCap] = useState<{ id: string; value: string } | null>(null);
  const [snippet, setSnippet] = useState<'curl' | 'node' | 'python'>('curl');

  const keys = payload?.keys ?? [];
  const paged = usePagedList(keys);

  const fetchKeys = useCallback(async () => {
    if (!signedIn) { setLoading(false); return; }
    const headers = await authHeader();
    if (!headers.Authorization) { setLoading(false); return; }
    setLoadError('');
    try {
      const r = await fetch('/api/keys', { headers });
      if (!r.ok) { setLoadError('Could not load your keys right now.'); return; }
      const d = (await r.json()) as KeysPayload;
      setPayload({
        keys: Array.isArray(d.keys) ? d.keys : [],
        availableScopes: Array.isArray(d.availableScopes) ? d.availableScopes : [],
        scopeDescriptions: d.scopeDescriptions ?? {},
        scopeRoutes: d.scopeRoutes ?? {},
        dailyCap: d.dailyCap ?? { default: 50, max: 1000 },
      });
    } catch {
      setLoadError('Could not load your keys right now.');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => { void fetchKeys(); }, [fetchKeys]);

  const fullAccess = scopes.includes(FULL_ACCESS);

  /**
   * 🔑 FULL ACCESS AND THE NARROW PERMISSIONS ARE MUTUALLY EXCLUSIVE ON THIS SCREEN.
   *
   * The server would accept `['all', 'ai:chat']` and behave identically (`hasScope` short-circuits on
   * `all`), but a form that lets both be ticked is a form that shows a tick meaning nothing — and the
   * tick a user would then untick to "remove" a permission they still have. So choosing full access
   * clears the rest, and choosing any narrow one turns full access off.
   */
  const toggleScope = (s: string) =>
    setScopes((prev) => {
      if (s === FULL_ACCESS) return prev.includes(FULL_ACCESS) ? [] : [FULL_ACCESS];
      const rest = prev.filter((x) => x !== FULL_ACCESS);
      return rest.includes(s) ? rest.filter((x) => x !== s) : [...rest, s];
    });

  const createKey = async () => {
    setError('');
    if (scopes.length === 0) { setError('Choose at least one thing this key may do.'); return; }
    const headers = await authHeader();
    if (!headers.Authorization) { setError('Please sign in first.'); return; }
    setCreating(true);
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Untitled key',
          scopes,
          ...(capInr.trim() ? { dailyCapInr: Number(capInr) } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'Could not create the key.'); return; }
      setFreshKey({ key: d.key, id: d.id });
      setTestResult(null);
      setName(''); setCapInr('');
      await fetchKeys();
    } catch {
      setError('Could not create the key.');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    const headers = await authHeader();
    if (!headers.Authorization) return;
    try {
      const r = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (r.ok) await fetchKeys();
    } catch { /* the list simply stays as it was */ }
  };

  const saveCap = async () => {
    if (!editingCap) return;
    const headers = await authHeader();
    if (!headers.Authorization) return;
    try {
      const r = await fetch(`/api/keys/${encodeURIComponent(editingCap.id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyCapInr: Number(editingCap.value) }),
      });
      if (r.ok) { setEditingCap(null); await fetchKeys(); }
    } catch { /* keep the editor open so the user can retry */ }
  };

  const copyFresh = async () => {
    if (!freshKey) return;
    try { await navigator.clipboard.writeText(freshKey.key); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked — the key is still on screen */ }
  };

  /**
   * THE PROOF. Calls the live API with the key that was just made. This is what makes "keys are not
   * fake" a thing the user has seen rather than a thing we said — and it runs while the secret is
   * still on screen, because that is the only moment the browser has it.
   */
  const testFresh = async () => {
    if (!freshKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${apiBase()}/me`, { headers: { 'X-API-Key': freshKey.key } });
      const text = await r.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* leave as-is */ }
      setTestResult({ ok: r.ok, text: `HTTP ${r.status}\n${pretty}` });
    } catch (e) {
      setTestResult({ ok: false, text: `Request failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  const base = apiBase();
  const snippets = useMemo(() => ({
    curl:
`# What can this key do, and what has it spent today? (any valid key)
curl ${base}/key -H "X-API-Key: nbai_YOUR_KEY"

# Ask NavBharatAI's AI (ai:chat) — standard chat-completions format
curl ${base}/chat/completions \\
  -H "Authorization: Bearer nbai_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Explain GST in one line"}]}'

# Ask one of the expert AIs (ai:professionals) — list them at ${base}/professionals
curl ${base}/professionals/teacher_ai/chat \\
  -H "Authorization: Bearer nbai_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Explain photosynthesis to a class 8 student"}]}'

# Make an image (ai:images) — Pro engine, ₹1 per image from your wallet
curl ${base}/images/generations \\
  -H "Authorization: Bearer nbai_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"a chai stall at sunrise, warm light","n":1,"response_format":"data_url"}'`,
    node:
`import OpenAI from "openai";

// Any standard chat-completions client works — only the base URL and key change.
const client = new OpenAI({ apiKey: "nbai_YOUR_KEY", baseURL: "${base}" });

const reply = await client.chat.completions.create({
  model: "navbharatai",
  messages: [{ role: "user", content: "Explain GST in one line" }],
});
console.log(reply.choices[0].message.content);

// An expert AI is just another model name (needs the ai:professionals permission).
const teacher = await client.chat.completions.create({
  model: "navbharatai/teacher_ai",
  messages: [{ role: "user", content: "Explain photosynthesis to a class 8 student" }],
});
console.log(teacher.choices[0].message.content);

// Images (needs ai:images). Each one costs ₹1 from your wallet.
const pic = await client.images.generate({ prompt: "a chai stall at sunrise, warm light" });
console.log(pic.data[0].b64_json.slice(0, 40) + "...");`,
    python:
`from openai import OpenAI

client = OpenAI(api_key="nbai_YOUR_KEY", base_url="${base}")

reply = client.chat.completions.create(
    model="navbharatai",
    messages=[{"role": "user", "content": "Explain GST in one line"}],
)
print(reply.choices[0].message.content)

# An expert AI is just another model name (needs the ai:professionals permission).
teacher = client.chat.completions.create(
    model="navbharatai/teacher_ai",
    messages=[{"role": "user", "content": "Explain photosynthesis to a class 8 student"}],
)
print(teacher.choices[0].message.content)

# Images (needs ai:images). Each one costs \u20b91 from your wallet.
pic = client.images.generate(prompt="a chai stall at sunrise, warm light")
print(pic.data[0].b64_json[:40], "...")`,
  }), [base]);

  return (
    <div className="bg-card border border-indigo-500/20 rounded-2xl p-4 sm:p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
          <Key className="w-5 h-5 text-accent-text" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-ink uppercase tracking-widest">NavBharatAI API</h2>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            Use NavBharatAI from your own program or app — read your account, list your apps, ask
            NavBharatAI's AI or any of its expert AIs, and generate images. It speaks the standard
            chat-completions format, so an SDK you already have works by changing two lines. You choose
            exactly what each key may do, and how much it may spend per day.
          </p>
        </div>
      </div>

      {!signedIn ? (
        <div className="bg-surface border border-line rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[11px] text-muted flex-1">Sign in to create API keys for your account.</p>
          {onShowLogin && (
            <button onClick={onShowLogin} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-on-accent rounded-lg text-xs font-bold">
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </button>
          )}
        </div>
      ) : (
        <>
          {/* One-time reveal of a freshly created key + the live test */}
          {freshKey && (
            <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 space-y-2">
              <div className="flex items-center gap-2 text-warn text-[11px] font-black">
                <AlertTriangle className="w-3.5 h-3.5" /> Copy this key now — it will not be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-ink bg-well rounded-lg px-3 py-2 font-mono break-all">{freshKey.key}</code>
                <button onClick={copyFresh} className="px-2 py-2 bg-indigo-600 rounded-lg text-on-accent shrink-0" aria-label="Copy key">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={testFresh} disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-on-accent rounded-lg text-[11px] font-bold disabled:opacity-50">
                  <Play className="w-3 h-3" /> {testing ? 'Testing…' : 'Test this key now'}
                </button>
                <span className="text-[10px] text-muted">Calls <code className="font-mono">GET {base}/me</code> with this key, live.</span>
                <button onClick={() => { setFreshKey(null); setTestResult(null); }} className="ml-auto text-[10px] text-muted hover:text-ink">I've saved it — dismiss</button>
              </div>
              {testResult && (
                <pre className={`text-[10px] font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all ${testResult.ok ? 'bg-emerald-500/10 text-success border border-emerald-500/30' : 'bg-red-500/10 text-danger border border-red-500/30'}`}>{testResult.text}</pre>
              )}
            </div>
          )}

          {/* Create form */}
          <div className="bg-surface rounded-xl p-4 border border-line space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">Create a key</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (e.g. my chatbot, CI pipeline)"
              className="w-full bg-card border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500"
            />

            <div>
              <p className="text-[10px] font-bold text-muted mb-1.5">What may this key do? <span className="text-faint">(you can change this later)</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(payload?.availableScopes ?? []).map((s) => {
                  const isFull = s === FULL_ACCESS;
                  // A narrow permission is COVERED (not ticked) while full access is on: the key really
                  // does have it, and showing an empty box beside a key that holds it would be a lie.
                  const covered = fullAccess && !isFull;
                  const on = isFull ? fullAccess : scopes.includes(s) || covered;
                  const d = payload?.scopeDescriptions?.[s];
                  const route = payload?.scopeRoutes?.[s];
                  return (
                    <button key={s} type="button" onClick={() => toggleScope(s)} aria-pressed={isFull ? fullAccess : scopes.includes(s)}
                      className={`text-left rounded-xl border p-3 transition-colors ${
                        isFull && fullAccess ? 'bg-indigo-500/15 border-indigo-500/50'
                        : covered ? 'bg-well border-line opacity-60'
                        : on ? 'bg-indigo-500/15 border-indigo-500/50'
                        : 'bg-well border-line hover:border-line'} ${isFull ? 'sm:col-span-2' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-indigo-500 border-indigo-400 text-on-accent' : 'border-line'}`}>
                          {on && <Check className="w-2.5 h-2.5 text-ink" />}
                        </span>
                        <span className="text-[11px] font-bold text-ink">{d?.title ?? s}</span>
                        {covered && <span className="text-[9px] text-muted">included in full access</span>}
                        <code className="ml-auto text-[9px] font-mono text-muted">{s}</code>
                      </div>
                      {d?.detail && <p className="text-[10px] text-muted mt-1 leading-snug">{d.detail}</p>}
                      {route
                        ? <p className="text-[9px] font-mono text-faint mt-1">{route.method} {route.path}</p>
                        : isFull && <p className="text-[9px] font-mono text-faint mt-1">every endpoint</p>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-[10px] font-bold text-muted sm:w-56">
                Daily spending limit for this key (₹)
                <span className="block text-[9px] font-normal text-faint">Applies to AI answers. Default ₹{payload?.dailyCap.default ?? 50}, max ₹{payload?.dailyCap.max ?? 1000}. A leaked key can never cost more than this in a day.</span>
              </label>
              <input
                type="number" inputMode="numeric" min={1} max={payload?.dailyCap.max ?? 1000}
                value={capInr} onChange={(e) => setCapInr(e.target.value)}
                placeholder={String(payload?.dailyCap.default ?? 50)}
                className="w-32 bg-card border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500"
              />
            </div>

            {error && <p className="text-[11px] text-danger">{error}</p>}
            <button onClick={createKey} disabled={creating}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-on-accent rounded-lg text-xs font-bold disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> {creating ? 'Creating…' : 'Create key'}
            </button>
          </div>

          {/* Existing keys */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">Your keys</h3>
            {loading ? (
              <p className="text-[11px] text-faint">Loading…</p>
            ) : loadError ? (
              <p className="text-[11px] text-danger">{loadError}</p>
            ) : keys.length === 0 ? (
              <p className="text-[11px] text-faint">No API keys yet. Create one above.</p>
            ) : (
              <>
                {paged.visible.map((k) => (
                  <div key={k.id} className={`bg-surface rounded-xl p-3 border border-line ${k.revoked ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-ink truncate">
                          {k.name} {k.revoked && <span className="text-danger font-normal">(revoked)</span>}
                        </div>
                        <div className="text-[10px] text-muted font-mono truncate">{k.displayPrefix}…{k.last4} · {k.scopes.join(', ')}</div>
                        <div className="text-[10px] text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Daily limit ₹{k.dailyCapInr}</span>
                          {k.todaySpentInr !== null && <span>Today ₹{k.todaySpentInr}{k.todayCalls !== null ? ` · ${k.todayCalls} call${k.todayCalls === 1 ? '' : 's'}` : ''}</span>}
                          <span>Last used {when(k.lastUsedAt)}</span>
                        </div>
                        {editingCap?.id === k.id && (
                          <div className="flex items-center gap-2 mt-2">
                            <input type="number" min={1} max={payload?.dailyCap.max ?? 1000} value={editingCap.value}
                              onChange={(e) => setEditingCap({ id: k.id, value: e.target.value })}
                              className="w-28 bg-card border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-indigo-500" />
                            <button onClick={saveCap} className="px-2.5 py-1 bg-indigo-600 text-on-accent rounded-lg text-[10px] font-bold">Save limit</button>
                            <button onClick={() => setEditingCap(null)} className="text-[10px] text-muted hover:text-ink">Cancel</button>
                          </div>
                        )}
                      </div>
                      {!k.revoked && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setEditingCap({ id: k.id, value: String(k.dailyCapInr) })} className="p-1.5 text-muted hover:text-ink" aria-label="Change daily limit" title="Change daily limit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => revokeKey(k.id)} className="p-1.5 text-muted hover:text-danger" aria-label="Revoke key" title="Revoke key">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <LoadMore list={paged} label="keys" />
              </>
            )}
          </div>
        </>
      )}

      {/* Quick start — visible signed out too, so a developer can see what they would get */}
      <div className="bg-surface rounded-xl p-4 border border-line space-y-3">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-accent-text" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">Quick start</h3>
          <div className="ml-auto flex gap-1">
            {(['curl', 'node', 'python'] as const).map((s) => (
              <button key={s} onClick={() => setSnippet(s)}
                className={`px-2 py-1 rounded-md text-[10px] font-bold ${snippet === s ? 'bg-indigo-600 text-on-accent' : 'text-muted hover:text-ink'}`}>
                {s === 'node' ? 'Node.js' : s === 'python' ? 'Python' : 'curl'}
              </button>
            ))}
          </div>
        </div>
        <pre className="text-[10px] font-mono text-body bg-well rounded-lg p-3 overflow-x-auto whitespace-pre">{snippets[snippet]}</pre>
        <ul className="text-[10px] text-muted space-y-1 leading-relaxed">
          <li className="flex gap-2"><ShieldCheck className="w-3 h-3 text-success shrink-0 mt-0.5" /> Base URL <code className="font-mono text-ink">{base}</code>. Send the key as <code className="font-mono">X-API-Key</code> or <code className="font-mono">Authorization: Bearer</code>.</li>
          <li className="flex gap-2"><ShieldCheck className="w-3 h-3 text-success shrink-0 mt-0.5" /> AI answers cost the same as in the app and come from your wallet — never more than the key's daily limit.</li>
          {/* Said plainly because the protocol alone cannot say it: a developer who chose streaming for
              speed deserves to know the answer arrives in one piece, and why that keeps their bill real. */}
          <li className="flex gap-2"><ShieldCheck className="w-3 h-3 text-success shrink-0 mt-0.5" /> <span><code className="font-mono">stream: true</code> works with any standard SDK. Today the answer arrives in one piece rather than word by word, so every answer is measured and billed at exactly the same price as a normal one.</span></li>
          <li className="flex gap-2"><AlertTriangle className="w-3 h-3 text-warn shrink-0 mt-0.5" /> Keep the key on your server. Never put it inside a website's front-end code — anyone could read it there. An app you publish with NavBharatAI gets its AI assistant built in automatically, with no key at all.</li>
        </ul>
      </div>
    </div>
  );
}

export default DeveloperApiCard;
