// AgentV3 — Golden Scaffolds: the shared PRO-tier foundation.
//
// WHY PRO SCAFFOLDS ARE SHAPED DIFFERENTLY FROM SIMPLE ONES. For a simple chip ("to-do list") the
// scaffold essentially IS the finished app — one App.tsx and it is done. A pro chip ("build a CRM with
// a kanban pipeline, contact profiles, notes, tasks and a dashboard") is not one screen and never will
// be; a single 800-line App.tsx would be exactly the monolith the EDIT-RESILIENCE rule forbids, and the
// builder's first edit would risk the whole app.
//
// So a pro scaffold ships an ARCHITECTURE, compile-proven, that the builder then fills in:
//   src/lib/ui.tsx     — the shared visual language (shell, card, stat, badge, button, field, modal)
//   src/lib/store.ts   — persistent CRUD state, so data survives a reload on the very first build
//   src/App.tsx        — this app's screens, composed from the two above
// Small, single-purpose, decoupled files — the shape the system prompt demands of every build, handed
// over already correct instead of hoped for.
//
// SIZE (admin: "app ka size improve na ho"): server-only module, exactly like the rest of
// goldenScaffolds/ — the client bundle and the Play Store build grow by ZERO bytes.

/**
 * The shared visual language. Deliberately plain React + inline styles driven by the base index.css
 * variables: no UI library to install, nothing to resolve, nothing that can fail `npm install` on the
 * first build — and it inherits light/dark from the platform base for free.
 */
export const proUiTsx = `import { useState, type ReactNode, type CSSProperties } from 'react';

/** The app frame: a fixed sidebar of sections, a titled top bar, and the active screen. */
export function Shell(props: {
  brand: string;
  nav: Array<{ id: string; label: string }>;
  active: string;
  onNavigate: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = props.nav.find((n) => n.id === props.active);
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
      <aside
        style={{
          width: 216, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--card)',
          padding: 16, position: 'fixed', insetBlock: 0, left: 0, zIndex: 20,
          transform: open ? 'translateX(0)' : undefined,
        }}
        className={open ? 'nb-sidebar nb-open' : 'nb-sidebar'}
      >
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 18 }}>{props.brand}</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {props.nav.map((n) => (
            <button
              key={n.id}
              onClick={() => { props.onNavigate(n.id); setOpen(false); }}
              aria-current={n.id === props.active ? 'page' : undefined}
              style={{
                textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: n.id === props.active ? 700 : 500,
                background: n.id === props.active ? 'var(--accent-soft)' : 'transparent',
                color: n.id === props.active ? 'var(--accent)' : 'var(--fg)',
              }}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }} className="nb-main">
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
            borderBottom: '1px solid var(--border)', background: 'var(--card)',
            position: 'sticky', top: 0, zIndex: 10,
          }}
        >
          <button onClick={() => setOpen((v) => !v)} className="nb-burger" aria-label="Menu" style={{ padding: '6px 10px' }}>
            Menu
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0, flex: 1 }}>{current ? current.label : props.brand}</h1>
          {props.actions}
        </header>
        <main style={{ padding: 20, maxWidth: 1100 }}>{props.children}</main>
      </div>

      <style>{
        '.nb-sidebar{transition:transform .2s ease}' +
        '.nb-main{margin-left:216px}' +
        '.nb-burger{display:none}' +
        '@media(max-width:820px){' +
          '.nb-sidebar{transform:translateX(-100%)}' +
          '.nb-sidebar.nb-open{transform:translateX(0)}' +
          '.nb-main{margin-left:0}' +
          '.nb-burger{display:inline-block}' +
        '}'
      }</style>
    </div>
  );
}

export function Card(props: { title?: string; actions?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 16, marginBottom: 16, ...props.style,
      }}
    >
      {(props.title || props.actions) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {props.title && <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, flex: 1 }}>{props.title}</h2>}
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function StatTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{props.label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{props.value}</div>
      {props.hint && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{props.hint}</div>}
    </div>
  );
}

export function StatRow(props: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 16 }}>
      {props.children}
    </div>
  );
}

const TONES: Record<string, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--accent-soft)', fg: 'var(--muted)' },
  accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  good: { bg: 'rgba(22,163,74,.12)', fg: '#16a34a' },
  warn: { bg: 'rgba(217,119,6,.14)', fg: '#d97706' },
  bad: { bg: 'rgba(220,38,38,.12)', fg: '#dc2626' },
};

export function Badge(props: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' }) {
  const t = TONES[props.tone || 'neutral'];
  return (
    <span style={{ background: t.bg, color: t.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {props.children}
    </span>
  );
}

export function Button(props: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; type?: 'button' | 'submit' }) {
  const v = props.variant || 'primary';
  return (
    <button
      type={props.type || 'button'}
      onClick={props.onClick}
      style={{
        padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: v === 'ghost' ? '1px solid var(--border)' : 'none',
        background: v === 'primary' ? 'var(--accent)' : v === 'danger' ? '#dc2626' : 'transparent',
        color: v === 'ghost' ? 'var(--fg)' : '#fff',
      }}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>{props.label}</span>
      <input
        type={props.type || 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 14 }}
      />
    </label>
  );
}

export function Select(props: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 14 }}
      >
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      onClick={props.onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(460px,100%)', maxHeight: '86vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>{props.title}</h2>
          <button onClick={props.onClose} aria-label="Close" style={{ padding: '4px 10px' }}>Close</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '28px 0', margin: 0 }}>{props.children}</p>;
}
`;

/**
 * Persistent CRUD state.
 *
 * Every pro app needs the same four operations over a list that survives a reload, and a first build
 * whose data vanishes on refresh reads as broken to a user however correct the code is. One tested hook
 * gives every scaffold that for free, and a corrupted/absent localStorage entry falls back to the seed
 * rather than throwing on mount (a throw here white-screens the whole app).
 */
export const proStoreTs = `import { useCallback, useEffect, useState } from 'react';

export interface Entity { id: string; }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function read<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : seed;
  } catch {
    // A corrupted entry must never throw during render — that white-screens the whole app.
    return seed;
  }
}

/** A persistent list with create / update / remove. The seed is used only on first run. */
export function useCollection<T extends Entity>(key: string, seed: T[]) {
  const [items, setItems] = useState<T[]>(() => read<T>(key, seed));

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* quota or private mode — keep working in memory */ }
  }, [key, items]);

  const add = useCallback((item: Omit<T, 'id'>) => {
    const created = { ...(item as object), id: newId() } as T;
    setItems((list) => [created, ...list]);
    return created;
  }, []);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((it) => it.id !== id));
  }, []);

  return { items, setItems, add, update, remove };
}

/** Indian-format currency, which is what these apps are actually used for. */
export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
`;
