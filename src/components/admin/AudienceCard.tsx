// WHO CAME TO NAVBHARATAI ITSELF — the admin's own view of the website and the app.
//
// ADMIN 2026-09-14: *"kitne user hamari website par aye … kon aya v/s kitne aye (all time and today)"*.
//
// 🔒 THE WHOLE POINT OF THIS CARD IS THAT EVERY NUMBER SAYS WHAT IT IS. Three of the four things that
// could be asked here have honest limits, and a dashboard that hides them is worse than no dashboard:
// an app OPEN is not a Play Store install, an all-time PERSON count cannot exist while the visitor
// code rotates daily, and a number we could not read is shown as "not available" rather than as 0.

import { useState } from 'react';
import { Globe, Smartphone, AlertTriangle, Users, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

export interface AudienceSection {
  today: { views: number; people: number } | null;
  window: { days: number; views: number; people: number; since: string } | null;
  allTime: { views: number; lastSeenMs: number | null } | null;
  unavailable?: string;
}

export interface PeopleSection {
  registered: number;
  activeToday: number;
  joinedToday: number;
  lastActiveUnknown: number;
  today: Array<{ name: string; email: string; atMs: number }>;
  todayTruncated: boolean;
}

export interface AudienceCardProps {
  data: {
    website?: AudienceSection;
    app?: AudienceSection;
    people?: PeopleSection | null;
    notes?: Record<string, string>;
  } | null;
  /** Asked for only when the card is opened — see the note on the button below. */
  onOpen?: () => void;
  loading?: boolean;
}

const n = (v: number | undefined | null) => (typeof v === 'number' ? v.toLocaleString('en-IN') : '—');

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-well p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-2xl font-black text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

function Section({ title, icon: Icon, s, peopleLabel, openLabel }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  s: AudienceSection | undefined;
  peopleLabel: string;
  openLabel: string;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent-text">
        <Icon className="w-4 h-4" /> {title}
      </p>

      {/* 🔒 An unreadable counter says so. It must never render as three zeros, which would read as
          "nobody came" — the exact confusion this card exists to remove. */}
      {s?.unavailable && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-snug text-warn">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>{s.unavailable}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure
          label="Today"
          value={s?.today ? n(s.today.views) : 'Not available'}
          hint={s?.today ? `${n(s.today.people)} ${peopleLabel}` : undefined}
        />
        <Figure
          label={`Last ${s?.window?.days ?? 30} days`}
          value={s?.window ? n(s.window.views) : 'Not available'}
          hint={s?.window ? `${n(s.window.people)} ${peopleLabel} counted day by day` : undefined}
        />
        <Figure
          label="All time"
          value={s?.allTime ? n(s.allTime.views) : 'Not available'}
          hint={openLabel}
        />
      </div>
    </div>
  );
}

function People({ p }: { p: PeopleSection | null | undefined }) {
  const when = (ms: number) => {
    try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
  };
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent-text">
        <Users className="w-4 h-4" /> Who came — people who signed in
      </p>

      {!p ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-snug text-warn">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>This could not be read, so no names are shown. It does not mean nobody came.</span>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Figure label="Signed in today" value={n(p.activeToday)} />
            <Figure label="New today" value={n(p.joinedToday)} hint="accounts created today" />
            <Figure label="Registered" value={n(p.registered)} hint="all time" />
          </div>

          {/* 🔒 THE FIGURE THAT KEEPS THE OTHER TWO HONEST. "Last signed in" lives in Firebase Auth,
              which can be unreachable or capped — and an unknown is NOT "did not come today". Without
              this line an outage would read as a quiet day. */}
          {p.lastActiveUnknown > 0 && (
            <p className="text-[11px] leading-snug text-warn">
              {n(p.lastActiveUnknown)} {p.lastActiveUnknown === 1 ? 'account' : 'accounts'} could not be checked,
              so "signed in today" is at least {n(p.activeToday)}, not exactly.
            </p>
          )}

          {p.today.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-well">
              {p.today.map((u, i) => (
                <li key={`${u.email}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-body">{u.name}</span>
                    <span className="block truncate text-[10px] text-faint">{u.email}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{when(u.atMs)}</span>
                </li>
              ))}
              {p.todayTruncated && (
                <li className="px-3 py-2 text-[10px] text-faint">
                  Showing the {p.today.length} most recent. The count above is the full number.
                </li>
              )}
            </ul>
          ) : (
            <p className="py-3 text-center text-[11px] text-faint">Nobody has signed in yet today.</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ONE BUTTON, NOTHING SPILLED ON THE SCREEN (admin 2026-09-14: *"sab kuch button ke andar ho, screen
 * par bheed na dikhe"*).
 *
 * 🔒 IT IS NOT ONLY TIDINESS. The card stays CLOSED until it is pressed, and the data is asked for at
 * that moment — so the wallet scan and the Firebase Auth lookups behind "who came" never run on a
 * routine tab switch. The instruction and the cost point the same way, which is why it is a button and
 * not a smaller font.
 */
export function AudienceCard({ data, onOpen, loading }: AudienceCardProps) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data) onOpen?.();
  };

  return (
    <div className="rounded-[2rem] border border-line bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0 text-accent-text" />
          <span className="min-w-0">
            <span className="block text-sm font-black uppercase tracking-widest text-ink">Who came to NavBharatAI</span>
            <span className="block text-[11px] leading-snug text-faint">
              Website visits, app opens, and the people who signed in — today and all time.
            </span>
          </span>
        </span>
        {loading
          ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-muted" />
          : open
            ? <ChevronDown className="w-4 h-4 shrink-0 text-muted" />
            : <ChevronRight className="w-4 h-4 shrink-0 text-muted" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {!data && loading && <p className="py-4 text-center text-xs text-faint">Reading the counters…</p>}
          {!data && !loading && (
            <p className="py-4 text-center text-xs text-warn">
              The counters could not be read. This does not mean nobody came — press again to retry.
            </p>
          )}

          {data && (
            <>
              <Section
                title="Website — navbharatai.com"
                icon={Globe}
                s={data.website}
                peopleLabel="people"
                openLabel="page views since counting began"
              />

              <Section
                title="App — opens on a phone"
                icon={Smartphone}
                s={data.app}
                peopleLabel="devices"
                openLabel="opens since counting began"
              />

              <People p={data.people} />

              {/* THE LIMITS, IN THE ADMIN'S OWN LANGUAGE. Carried from the server payload so the screen
                  and the route can never drift into telling two different stories about one number. */}
              {data.notes && (
                <ul className="space-y-1.5 rounded-xl border border-line bg-well p-3 text-[11px] leading-snug text-muted">
                  {Object.entries(data.notes).map(([k, v]) => (
                    <li key={k} className="flex gap-2"><span className="text-faint">•</span><span>{v}</span></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
