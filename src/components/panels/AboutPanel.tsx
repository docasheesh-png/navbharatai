/**
 * ABOUT US — the page a person reads before deciding whether to trust an app that takes their money.
 *
 * The content itself lives in `src/content/about.ts`; this file only renders it. What the admin can
 * change from inside the app (headline, description, who builds it, the vision, the support address,
 * the logo) is saved on the SERVER, so an edit reaches every user — see `server/lib/siteAbout.ts` for
 * what that replaced.
 */
import { motion } from 'motion/react';
import { Shield, Bot, Camera, Edit2, User, Eye, Check, Sparkles, MapPin, Mail, Loader2 } from 'lucide-react';
import type { AboutContent, AboutOverrides } from '../../content/about';

export interface AboutPanelProps {
  isAdmin: boolean;
  about: AboutContent;
  /** Saving state, so an admin is never told "saved" before the server has said so. */
  saveState?: 'idle' | 'saving' | 'error';
  onOverrideChange: (patch: AboutOverrides) => void;
  onStartBuilding?: () => void;
}

/** One admin pencil. Hidden for everyone else — a normal user must never see an edit affordance. */
function EditButton({ label, current, onSave, tone = 'indigo' }: {
  label: string; current: string; onSave: (value: string) => void; tone?: 'indigo' | 'emerald';
}) {
  const colour = tone === 'emerald'
    ? 'hover:bg-emerald-600 text-emerald-400'
    : 'hover:bg-indigo-600 text-accent-text';
  return (
    <button
      onClick={() => {
        const next = prompt(label, current);
        if (next !== null) onSave(next);
      }}
      className={`p-2 bg-raised ${colour} hover:text-on-accent rounded-xl transition-all shrink-0`}
      title={label}
    >
      <Edit2 className="w-4 h-4" />
    </button>
  );
}

export function AboutPanel({ isAdmin, about, saveState = 'idle', onOverrideChange, onStartBuilding }: AboutPanelProps) {
  return (
    <div className="flex-1 bg-surface overflow-y-auto custom-scrollbar p-6 sm:p-12 relative">
      {isAdmin && (
        <div className="sticky top-0 right-0 z-50 flex justify-end pb-4">
          <div className="bg-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-on-accent shadow-xl flex items-center gap-2">
            {saveState === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            {/* An admin edit now reaches every user, so the badge says which of the three states it is in. */}
            {saveState === 'saving' ? 'Saving for everyone…' : saveState === 'error' ? 'Not saved — try again' : 'Admin edit mode — changes go live for all users'}
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-14 pb-24">
        {/* ── Who we are, in one screen ─────────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="inline-block p-4 bg-indigo-600/10 rounded-[2.5rem] border border-indigo-500/20 mb-2 relative">
            {about.logoUrl
              ? <img src={about.logoUrl} alt="" className="w-16 h-16 rounded-2xl object-cover" />
              : <Bot className="w-16 h-16 text-accent-text" />}
            {isAdmin && (
              <button
                onClick={() => {
                  const url = prompt('Logo URL (leave blank to use the default mark):', about.logoUrl);
                  if (url !== null) onOverrideChange({ logoUrl: url });
                }}
                className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 text-on-accent rounded-xl shadow-lg hover:scale-110 transition-all"
              >
                <Camera className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-center gap-3">
            <h1 className="text-4xl sm:text-6xl font-black text-ink tracking-tighter uppercase">{about.headline}</h1>
            {isAdmin && <EditButton label="Headline" current={about.headline} onSave={(v) => onOverrideChange({ headline: v })} />}
          </div>

          <p className="text-accent-text text-lg sm:text-xl font-bold tracking-tight">{about.tagline}</p>

          <div className="flex items-start justify-center gap-3">
            <p className="text-muted text-base sm:text-lg max-w-2xl font-medium leading-relaxed">{about.description}</p>
            {isAdmin && <EditButton label="Description" current={about.description} onSave={(v) => onOverrideChange({ description: v })} />}
          </div>
        </motion.header>

        {/* ── What you can do here, and why it is built for India ──────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {([
            { heading: about.whatWeBuildHeading, items: about.whatWeBuild, Icon: Sparkles, tone: 'text-accent-text' },
            { heading: about.indiaFirstHeading, items: about.indiaFirst, Icon: MapPin, tone: 'text-success' },
          ] as const).map(({ heading, items, Icon, tone }) => (
            <motion.section
              key={heading}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-card border border-line p-7 rounded-[2rem] space-y-4 shadow-xl"
            >
              <h2 className="flex items-center gap-2 text-lg font-black text-ink tracking-tight uppercase">
                <Icon className={`w-5 h-5 ${tone}`} /> {heading}
              </h2>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item} className="flex gap-3 text-muted font-medium leading-relaxed">
                    <Check className={`w-4 h-4 mt-1 shrink-0 ${tone}`} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.section>
          ))}
        </div>

        {/* ── Who builds it, and where it is going ─────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.section
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="bg-card border border-line p-7 rounded-[2rem] space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-3 text-lg font-black text-ink tracking-tight uppercase">
                <span className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-on-accent">
                  <User className="w-5 h-5 text-on-accent" />
                </span>
                {about.teamHeading}
              </h2>
              {isAdmin && <EditButton label="Who builds it" current={about.team} onSave={(v) => onOverrideChange({ team: v })} />}
            </div>
            <p className="text-muted font-medium leading-relaxed">{about.team}</p>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="bg-card border border-line p-7 rounded-[2rem] space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-3 text-lg font-black text-ink tracking-tight uppercase">
                <span className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center text-on-accent">
                  <Eye className="w-5 h-5 text-on-accent" />
                </span>
                {about.visionHeading}
              </h2>
              {isAdmin && <EditButton label="Vision" current={about.vision} tone="emerald" onSave={(v) => onOverrideChange({ vision: v })} />}
            </div>
            <p className="text-muted font-medium leading-relaxed">{about.vision}</p>
          </motion.section>
        </div>

        {/* ── The promises. Every one of these is a rule in the product, not a slogan. ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="space-y-5"
        >
          <h2 className="text-center text-lg font-black text-ink tracking-tight uppercase">{about.promisesHeading}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {about.promises.map((promise) => (
              <div key={promise.title} className="bg-raised border border-line p-6 rounded-[1.75rem] space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-black text-ink tracking-tight">
                  <Check className="w-4 h-4 text-success shrink-0" /> {promise.title}
                </h3>
                <p className="text-muted text-sm font-medium leading-relaxed">{promise.body}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── "We are early, and we say so" — the section a competitor would delete. ── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-amber-500/10 border border-amber-500/30 p-7 rounded-[2rem] space-y-3"
        >
          <h2 className="text-lg font-black text-warn tracking-tight uppercase">{about.honestyHeading}</h2>
          <p className="text-muted font-medium leading-relaxed">{about.honesty}</p>
        </motion.section>

        {/* ── Reach us. The legal links are a requirement in India, not decoration. ─── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-card border border-line p-7 rounded-[2rem] space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-black text-ink tracking-tight uppercase">
              <Mail className="w-5 h-5 text-accent-text" /> {about.contactHeading}
            </h2>
            {isAdmin && <EditButton label="Support email" current={about.contactEmail} onSave={(v) => onOverrideChange({ contactEmail: v })} />}
          </div>
          <p className="text-muted font-medium leading-relaxed">
            Write to <a className="text-accent-text font-bold underline" href={`mailto:${about.contactEmail}`}>{about.contactEmail}</a>.
          </p>
          <div className="flex flex-wrap gap-3 text-sm font-bold">
            <a className="text-accent-text hover:underline" href="/privacy">Privacy Policy</a>
            <span className="text-faint">·</span>
            <a className="text-accent-text hover:underline" href="/terms">Terms of Service</a>
            <span className="text-faint">·</span>
            <a className="text-accent-text hover:underline" href="/grievance">Grievance Officer</a>
          </div>
        </motion.section>

        {onStartBuilding && (
          <div className="text-center">
            <button
              onClick={onStartBuilding}
              className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-on-accent font-black tracking-tight rounded-2xl shadow-xl transition-all hover:scale-[1.02]"
            >
              {about.ctaLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
