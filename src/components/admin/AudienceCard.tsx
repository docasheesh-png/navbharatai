// WHO CAME TO NAVBHARATAI ITSELF — the admin's own view of the website and the app.
//
// ADMIN 2026-09-14: *"kitne user hamari website par aye … kon aya v/s kitne aye (all time and today)"*.
//
// 🔒 THE WHOLE POINT OF THIS CARD IS THAT EVERY NUMBER SAYS WHAT IT IS. Three of the four things that
// could be asked here have honest limits, and a dashboard that hides them is worse than no dashboard:
// an app OPEN is not a Play Store install, an all-time PERSON count cannot exist while the visitor
// code rotates daily, and a number we could not read is shown as "not available" rather than as 0.

import { Globe, Smartphone, AlertTriangle } from 'lucide-react';

export interface AudienceSection {
  today: { views: number; people: number } | null;
  window: { days: number; views: number; people: number; since: string } | null;
  allTime: { views: number; lastSeenMs: number | null } | null;
  unavailable?: string;
}

export interface AudienceCardProps {
  data: {
    website?: AudienceSection;
    app?: AudienceSection;
    notes?: Record<string, string>;
  } | null;
}

const n = (v: number | undefined | null) => (typeof v === 'number' ? v.toLocaleString('en-IN') : '—');

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-gray-500">{hint}</p>}
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
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-300">
        <Icon className="w-4 h-4" /> {title}
      </p>

      {/* 🔒 An unreadable counter says so. It must never render as three zeros, which would read as
          "nobody came" — the exact confusion this card exists to remove. */}
      {s?.unavailable && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-snug text-amber-300">
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

export function AudienceCard({ data }: AudienceCardProps) {
  return (
    <div className="space-y-4 rounded-[2rem] border border-white/5 bg-[#0d1117] p-4">
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-white">Who came to NavBharatAI</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Measured by our own server, not by anyone else's script.
        </p>
      </div>

      <Section
        title="Website — navbharatai.com"
        icon={Globe}
        s={data?.website}
        peopleLabel="people"
        openLabel="page views since counting began"
      />

      <Section
        title="App — opens on a phone"
        icon={Smartphone}
        s={data?.app}
        peopleLabel="devices"
        openLabel="opens since counting began"
      />

      {/* THE LIMITS, IN THE ADMIN'S OWN LANGUAGE. Carried from the server payload so the screen and the
          route can never drift into telling two different stories about the same number. */}
      {data?.notes && (
        <ul className="space-y-1.5 rounded-xl border border-white/5 bg-black/20 p-3 text-[11px] leading-snug text-gray-400">
          {Object.entries(data.notes).map(([k, v]) => (
            <li key={k} className="flex gap-2"><span className="text-gray-600">•</span><span>{v}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
