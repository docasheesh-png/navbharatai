import React from 'react';
import { motion } from 'motion/react';
import {
  Sparkles, Shield, MessageSquare, Bot, Zap, Rocket,
  CheckCircle2, ArrowRight, LayoutGrid, Store, Play, PlayCircle, X
} from 'lucide-react';
import { ThemeMode, getThemeClasses } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { openExternalUrl } from '../../lib/mobileNative';

/**
 * THE "HOW DO I BUILD AN APP?" VIDEO.
 *
 * The share URL the admin gave carried a `?si=` tracking token from their own share session. Dropped:
 * it identifies where THAT link was shared from, travels to every user, and buys us nothing.
 */
const HOW_TO_BUILD_VIDEO_URL = 'https://youtu.be/bUG33GYzeHc';

/** Remembering a dismissal must never be able to break the page. Private mode throws on both. */
const TUTORIAL_DISMISSED_KEY = 'nbai_home_tutorial_dismissed';
function readTutorialDismissed(): boolean {
  try { return localStorage.getItem(TUTORIAL_DISMISSED_KEY) === '1'; } catch { return false; }
}
function writeTutorialDismissed(): void {
  try { localStorage.setItem(TUTORIAL_DISMISSED_KEY, '1'); } catch { /* nothing to remember with */ }
}

interface HomeData {
  heroTitle: string;
  heroSubtitle: string;
  welcomeText: string;
  ctaText: string;
  features: Array<{
    title: string;
    subtitle: string;
    description: string;
    icon: string;
    color: string;
    status?: string;
  }>;
}

interface HomeViewProps {
  onStartChat: () => void;
  onStartProChat?: () => void;
  /** Open the "Other AI" page — the builder-tools hub (admin 2026-07-23: a full view, like the other 3). */
  onOpenOtherAI?: () => void;
  /**
   * Open App Mart — apps other people built, playable instantly (admin 2026-08-16).
   * It was buried inside Other's tool grid, where a store cannot do its job: a place nobody arrives
   * at has nothing to sell, and everything planned on top of it (ads, creator earnings) needs an
   * audience first. So it is promoted to a home tile of its own.
   */
  onOpenAppMart?: () => void;
  isAdmin?: boolean;
  data?: HomeData;
  onUpdate?: (newData: HomeData) => void;
  theme: ThemeMode;
  user: any;
  onShowLogin: () => void;
}

const PRODUCT_CARDS = [
  {
    id: 'free',
    badge: 'Free Forever',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    gradient: 'from-orange-500/20 via-amber-500/10 to-transparent',
    border: 'border-orange-500/20 hover:border-orange-500/40',
    glow: 'shadow-orange-500/10',
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    Icon: MessageSquare,
    title: 'NavBharatAI',
    subtitle: 'Free AI Chat',
    description: 'Ask anything in Hindi, English, or Hinglish — instant answers, explanations, ideas, creative writing, and everyday help. Your free AI companion to learn and get things done. (For building apps, use NavBharatAI Pro.)',
    features: ['Chat in Hindi, English & Hinglish', 'Instant answers, research & learning', 'Creative writing, summaries & translation'],
    featureIcon: CheckCircle2,
    featureColor: 'text-orange-400',
    btnClass: 'bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300 text-white',
    btnLabel: 'Start Free Chat',
    btnLabelShort: 'Free Chat',
    btnIcon: MessageSquare,
  },
  {
    id: 'pro',
    badge: 'Pro v5.0',
    badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    gradient: 'from-indigo-600/20 via-purple-500/10 to-transparent',
    border: 'border-indigo-500/20 hover:border-indigo-400/50',
    glow: 'shadow-indigo-500/10',
    iconBg: 'bg-indigo-500/15',
    iconColor: 'text-indigo-400',
    Icon: Bot,
    title: 'NavBharatAI Pro',
    subtitle: 'Agentic App Builder',
    description: 'Describe any app in plain language and NavBharatAI Pro v5.0 plans, codes, previews and deploys it — automatically, end-to-end. This is the coding & app-building engine.',
    features: ['Full-stack app generation in minutes', 'Live preview + one-click deploy', "NavBharatAI's most powerful AI engine"],
    featureIcon: Zap,
    featureColor: 'text-indigo-400',
    btnClass: 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white',
    btnLabel: 'Open Pro Builder',
    btnLabelShort: 'Pro Builder',
    btnIcon: Rocket,
  },
  {
    id: 'tools',
    badge: '20+ Tools',
    badgeColor: 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30',
    gradient: 'from-fuchsia-600/20 via-pink-500/10 to-transparent',
    border: 'border-fuchsia-500/20 hover:border-fuchsia-400/50',
    glow: 'shadow-fuchsia-500/10',
    iconBg: 'bg-fuchsia-500/15',
    iconColor: 'text-fuchsia-400',
    Icon: LayoutGrid,
    title: 'Other',
    subtitle: 'Builder Tools & Utilities',
    description: 'Every extra AI utility to design, develop, ship and monetize your app — bot builder, image gen, debugger, deploy, SEO, monetization and more.',
    features: ['Design, develop, test & minify', 'Publish, deploy & custom domain', 'Monetize, analytics & team'],
    featureIcon: CheckCircle2,
    featureColor: 'text-fuchsia-400',
    btnClass: 'bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white',
    btnLabel: 'Open Tools',
    btnLabelShort: 'Tools',
    btnIcon: LayoutGrid,
  },
  {
    // APP MART — the fifth tile (admin 2026-08-16). This card is deliberately the only one that is
    // not about BUILDING: it is where you go to USE what other people built. That difference is the
    // whole reason it earns its own tile instead of a row inside Other's tool grid.
    id: 'appmart',
    badge: 'App Mart',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    gradient: 'from-emerald-600/20 via-teal-500/10 to-transparent',
    border: 'border-emerald-500/20 hover:border-emerald-400/50',
    glow: 'shadow-emerald-500/10',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    Icon: Store,
    title: 'App Mart',
    subtitle: 'Play & Install Apps',
    description: 'Apps and games made by other NavBharatAI creators. Tap one and it runs straight away in your browser — nothing to download, nothing to install. Like what you see? Make it yours in one tap and change it however you like.',
    features: ['Play instantly — no install', 'Install Android apps (.apk)', 'Remix any app into your own'],
    featureIcon: CheckCircle2,
    featureColor: 'text-emerald-400',
    btnClass: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white',
    phoneTagline: 'Games & apps by other creators — free to play',
    btnLabel: 'Open App Mart',
    btnLabelShort: 'Open App Mart',
    btnIcon: Play,
  },
];


export const HomeView = ({
  onStartChat,
  onStartProChat,
  onOpenOtherAI,
  onOpenAppMart,
  isAdmin,
  data,
  onUpdate,
  theme,
  user,
  onShowLogin,
}: HomeViewProps) => {
  const colors = getThemeClasses(theme);
  // Lazy initial read: touching localStorage during render is fine, but doing it on EVERY render is
  // a synchronous disk hit for a value that cannot change without us changing it.
  const [tutorialDismissed, setTutorialDismissed] = React.useState<boolean>(() => readTutorialDismissed());

  const handlers: Record<string, (() => void) | undefined> = {
    free: onStartChat,
    pro: onStartProChat,
    // "Other AI" navigates to its OWN full page (like the other 3 cards) — the tools live INSIDE it.
    tools: onOpenOtherAI,
    appmart: onOpenAppMart,
  };

  return (
    <div
      className={cn(
        'flex-1 flex flex-col items-center justify-start relative w-full overflow-y-auto overflow-x-hidden',
        colors.bg, colors.text
      )}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ scale: [1, 1.15, 1], rotate: [0, 60, 0], opacity: [0.08, 0.16, 0.08] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
          className="absolute -top-1/3 -left-1/4 w-3/4 h-3/4 bg-indigo-600/20 rounded-full blur-[100px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], rotate: [0, -60, 0], opacity: [0.06, 0.12, 0.06] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
          className="absolute -bottom-1/3 -right-1/4 w-3/4 h-3/4 bg-orange-500/15 rounded-full blur-[100px]"
        />
      </div>

      {/* Admin badge */}
      {isAdmin && (
        <div className="absolute top-4 right-4 z-50 bg-indigo-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl flex items-center gap-2">
          <Shield className="w-3 h-3" />
          Admin
        </div>
      )}

      <div className="relative z-10 w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col items-center gap-8 sm:gap-10">

        {/* ── Hero ── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center gap-4 max-w-2xl"
        >
          <motion.img
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 120, delay: 0.1 }}
            src="/logo.png"
            alt="NavBharat AI"
            className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-[0_8px_20px_rgba(249,115,22,0.25)] select-none pointer-events-none"
          />

          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5">
            <Sparkles className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="font-black uppercase tracking-[0.25em] text-indigo-400 text-[9px] sm:text-[10px]">
              {data?.welcomeText || 'Welcome to the Future'}
            </span>
          </div>

          <h1 className="font-black text-white tracking-tight leading-none text-3xl sm:text-4xl md:text-5xl">
            <span>NAVBHARAT&nbsp;</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-orange-400">
              AI
            </span>
          </h1>

          <p className="text-[#8b949e] font-medium leading-relaxed text-sm sm:text-base max-w-lg">
            {data?.heroSubtitle || 'The most advanced AI workspace built for the next billion developers and creators from Bharat.'}
          </p>
        </motion.div>

        {/* ── "I'M STUCK — SHOW ME HOW" ────────────────────────────────────────────────────────────
            Asked for as a small green "i" above the Pro card, which on tapping shows a button, which
            on tapping opens the video. Built as ONE tap instead of three, and deliberately:

              • A popup whose entire contents is a single button is a step that asks the user to
                confirm they meant the thing they just tapped. The video is the whole feature; the
                strip IS the button.
              • A small "i" is the wrong target for the exact person this is for. Someone whose first
                build did not work is not going to hunt a 16px icon — and "i" reads as "terms and
                conditions", not "watch someone do this". A play symbol and a sentence say it at a
                glance.
              • Full width above the grid, not tucked over one card: on a phone the cards are a 2-up
                grid and the space above a single card is a sliver. This is also honest placement —
                the help is about building apps, which is what the whole page is for.
              • ENGLISH, not Hinglish. The first version of this strip read "App banane me dikkat aa
                rahi hai?" — reasoning that a Bharat-first audience reads Hindi. That reasoning is
                not mine to apply here: CLAUDE.md's language standard requires every UI label in
                NavBharatAI to be professional English, and the ONLY exception is AI-generated reply
                text inside a chat bubble. This is a product label, so it is English. Kept short and
                plain so it reads easily for a non-native speaker; the VIDEO can be in any language.
                The Hindi and Hinglish phrasings live where they belong — the AppKnowledgeBase
                keywords, which that same standard requires to carry the words a user would type.

            DISMISSIBLE, but never gone: the × collapses it to a small green play chip that stays.
            A user who dismissed it in month one and gets stuck in month three must still be able to
            find it — a help link that can be permanently deleted is a help link that eventually is. */}
        {!tutorialDismissed ? (
          <div className="w-full flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => openExternalUrl(HOW_TO_BUILD_VIDEO_URL)}
              aria-label="Watch the video: how to build your first app with NavBharatAI Pro"
              className="group flex-1 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-600/15 via-emerald-500/10 to-transparent px-4 py-3 text-left transition-colors hover:border-emerald-400/60 hover:from-emerald-600/25"
            >
              <span className="shrink-0 rounded-xl bg-emerald-500/20 p-2">
                <PlayCircle className="w-5 h-5 text-emerald-400" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-white leading-tight">
                  Stuck building your app?
                </span>
                <span className="block text-[11px] sm:text-xs text-emerald-300/80 leading-snug mt-0.5">
                  Watch a short video on how to build one
                </span>
              </span>
              <ArrowRight className="w-4 h-4 text-emerald-400/70 ml-auto shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => { writeTutorialDismissed(); setTutorialDismissed(true); }}
              aria-label="Hide this tip"
              title="Hide"
              className="shrink-0 px-2 rounded-2xl border border-white/10 text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="w-full flex justify-end">
            <button
              type="button"
              onClick={() => openExternalUrl(HOW_TO_BUILD_VIDEO_URL)}
              aria-label="Watch the video: how to build your first app with NavBharatAI Pro"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/20 transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" /> How to build an app
            </button>
          </div>
        )}

        {/* ── Product Cards (4: Free / Pro / Professionals / Other AI) ── */}
        <div className="w-full grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
          {PRODUCT_CARDS.map((rawCard, i) => {
            const card = rawCard;
            const CardIcon = card.Icon;
            const BtnIcon = card.btnIcon;
            const FeatIcon = card.featureIcon;
            const handler = handlers[card.id];
            const comingSoon = (card as { comingSoon?: boolean }).comingSoon === true;

            return (
              <motion.button
                key={card.id}
                type="button"
                onClick={comingSoon ? undefined : (handler || onShowLogin)}
                disabled={comingSoon}
                aria-label={`${card.title} — ${card.subtitle}`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 + i * 0.1 }}
                className={cn(
                  'text-left w-full',
                  comingSoon ? 'cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]',
                  'relative flex flex-col rounded-2xl sm:rounded-3xl border bg-[#0d1117] overflow-hidden',
                  'shadow-xl transition-all duration-300',
                  // PHONE LAYOUT (admin 2026-08-16, given as a drawing): a 2-up grid of SQUARE tiles
                  // with App Mart lying across the bottom, 2x1. On a phone the old one-per-row cards
                  // meant four scrolls before App Mart was even on screen — the opposite of promoting
                  // it. Squares only work if the content inside them shrinks too, which is what the
                  // `hidden sm:…` rules below do; from `sm` up the full cards return untouched.
                  'aspect-square',
                  'sm:aspect-auto',
                  card.border, card.glow
                )}
              >
                {/* Card gradient overlay */}
                <div className={cn('absolute inset-0 bg-gradient-to-br pointer-events-none', card.gradient)} />

                <div className="relative z-10 flex flex-col h-full p-3.5 sm:p-6 gap-2 sm:gap-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn('w-9 h-9 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl flex items-center justify-center shrink-0', card.iconBg)}>
                      <CardIcon className={cn('w-4 h-4 sm:w-6 sm:h-6', card.iconColor)} />
                    </div>
                    <span className={cn('hidden sm:inline-block text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1 shrink-0', card.badgeColor)}>
                      {card.badge}
                    </span>
                  </div>

                  {/* Title + description */}
                  <div className="flex flex-col gap-1">
                    <h2 className="font-black text-white text-sm sm:text-lg leading-tight">{card.title}</h2>
                    <p className={cn('text-[9px] sm:text-[11px] font-bold uppercase tracking-wider sm:tracking-widest leading-tight', card.iconColor)}>{card.subtitle}</p>
                  </div>

                  {(card as { phoneTagline?: string }).phoneTagline && (
                    <p className="sm:hidden text-[#8b949e] text-[10px] leading-snug shrink-0 truncate">
                      {(card as { phoneTagline?: string }).phoneTagline}
                    </p>
                  )}

                  <p className="hidden sm:block text-[#8b949e] text-xs sm:text-sm leading-relaxed flex-1">
                    {card.description}
                  </p>

                  {/* Features */}
                  <ul className="hidden sm:flex flex-col gap-1.5">
                    {card.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <FeatIcon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', card.featureColor)} />
                        <span className="text-[11px] sm:text-xs text-[#8b949e] leading-snug">{feat}</span>
                      </li>
                    ))}
                  </ul>


                  {/* CTA — a LOOK, not a second click target: the whole card is the button. */}
                  <span
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-3 rounded-lg sm:rounded-2xl',
                      'font-black text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest transition-all duration-200',
                      'select-none mt-auto',
                      comingSoon && 'opacity-70',
                      card.btnClass
                    )}
                  >
                    <BtnIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate sm:hidden">{(card as { btnLabelShort?: string }).btnLabelShort ?? card.btnLabel}</span>
                    <span className="truncate hidden sm:inline">{card.btnLabel}</span>
                    {!comingSoon && <ArrowRight className="hidden sm:block w-3.5 h-3.5 shrink-0 ml-auto" />}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* The "Other AI" builder tools now live on their OWN page (OtherAIView), opened by the 4th
            card above — not revealed below the cards (admin 2026-07-23). */}

        {/* ── Footer tagline ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-[11px] text-[#484f58] font-medium tracking-wide text-center pb-2"
        >
          Made with ❤️ for Bharat · Free to use · No credit card required
        </motion.p>
      </div>
    </div>
  );
};
