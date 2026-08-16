import React from 'react';
import { motion } from 'motion/react';
import {
  Sparkles, Shield, MessageSquare, Bot, Stethoscope,
  Scale, GraduationCap, Activity, Zap, Code2, Rocket,
  CheckCircle2, ArrowRight, ChevronRight, LayoutGrid, Store, Play
} from 'lucide-react';
import { ThemeMode, getThemeClasses } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { isNativeApp } from '../../lib/mobileNative';
import { medicalFeaturesHidden, professionalsCardCopy } from '../../lib/playCompliance';

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
  onStartProfessionals?: () => void;
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
    btnIcon: Rocket,
  },
  {
    id: 'professionals',
    badge: '50+ Expert AIs',
    badgeColor: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
    gradient: 'from-teal-600/20 via-cyan-500/10 to-transparent',
    border: 'border-teal-500/20 hover:border-teal-400/50',
    glow: 'shadow-teal-500/10',
    iconBg: 'bg-teal-500/15',
    iconColor: 'text-teal-400',
    Icon: Shield,
    title: 'Professionals',
    subtitle: 'Expert AI Assistants',
    description: 'Dedicated AI experts for every life domain — Doctor, Lawyer, Teacher, Financial Advisor, Kisan Advisor, and 45+ more.',
    features: ['Doctor AI, Lawyer AI, Teacher AI', 'Kisan, Finance, Career & Wellness', 'Answers in Hindi + regional languages'],
    featureIcon: CheckCircle2,
    featureColor: 'text-teal-400',
    btnClass: 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white',
    btnLabel: 'Explore Professionals',
    btnIcon: ChevronRight,
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
    btnLabel: 'Open App Mart',
    btnIcon: Play,
  },
];

const PROF_ICONS = [Stethoscope, Scale, GraduationCap, Activity, Code2];
// Play compliance (admin 2026-08-04): inside the native shell the Professionals card must not
// advertise medical features — no "Doctor AI" copy, no stethoscope icon (playCompliance.ts).
const PROF_ICONS_NATIVE = [Scale, GraduationCap, Activity, Code2];

export const HomeView = ({
  onStartChat,
  onStartProChat,
  onStartProfessionals,
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

  const handlers: Record<string, (() => void) | undefined> = {
    free: onStartChat,
    pro: onStartProChat,
    professionals: onStartProfessionals,
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

        {/* ── Product Cards (4: Free / Pro / Professionals / Other AI) ── */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-5">
          {PRODUCT_CARDS.map((rawCard, i) => {
            // Play compliance: the Professionals card's copy must not name medical assistants in the
            // native shell (the shipped app declares no medical features — copy and app must match).
            const hideMedical = medicalFeaturesHidden(isNativeApp());
            const card = rawCard.id === 'professionals' && hideMedical
              ? { ...rawCard, ...professionalsCardCopy(true), features: [...professionalsCardCopy(true).features] }
              : rawCard;
            const CardIcon = card.Icon;
            const BtnIcon = card.btnIcon;
            const FeatIcon = card.featureIcon;
            const handler = handlers[card.id];
            const comingSoon = (card as { comingSoon?: boolean }).comingSoon === true;

            return (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 + i * 0.1 }}
                className={cn(
                  'relative flex flex-col rounded-2xl sm:rounded-3xl border bg-[#0d1117] overflow-hidden',
                  'shadow-xl transition-all duration-300',
                  card.border, card.glow
                )}
              >
                {/* Card gradient overlay */}
                <div className={cn('absolute inset-0 bg-gradient-to-br pointer-events-none', card.gradient)} />

                <div className="relative z-10 flex flex-col h-full p-5 sm:p-6 gap-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn('w-11 h-11 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0', card.iconBg)}>
                      <CardIcon className={cn('w-5 h-5 sm:w-6 sm:h-6', card.iconColor)} />
                    </div>
                    <span className={cn('text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1 shrink-0', card.badgeColor)}>
                      {card.badge}
                    </span>
                  </div>

                  {/* Title + description */}
                  <div className="flex flex-col gap-1">
                    <h2 className="font-black text-white text-base sm:text-lg leading-tight">{card.title}</h2>
                    <p className={cn('text-[11px] font-bold uppercase tracking-widest', card.iconColor)}>{card.subtitle}</p>
                  </div>

                  <p className="text-[#8b949e] text-xs sm:text-sm leading-relaxed flex-1">
                    {card.description}
                  </p>

                  {/* Features */}
                  <ul className="flex flex-col gap-1.5">
                    {card.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <FeatIcon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', card.featureColor)} />
                        <span className="text-[11px] sm:text-xs text-[#8b949e] leading-snug">{feat}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Professionals mini-icon row */}
                  {card.id === 'professionals' && (
                    <div className="flex items-center gap-2">
                      {(hideMedical ? PROF_ICONS_NATIVE : PROF_ICONS).map((PIcon, idx) => (
                        <div key={idx} className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                          <PIcon className="w-3.5 h-3.5 text-teal-400" />
                        </div>
                      ))}
                      <span className="text-[10px] text-[#8b949e] font-bold">+45 more</span>
                    </div>
                  )}

                  {/* CTA Button */}
                  <button
                    onClick={comingSoon ? undefined : (handler || onShowLogin)}
                    disabled={comingSoon}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl sm:rounded-2xl',
                      'font-black text-xs uppercase tracking-widest transition-all duration-200',
                      'select-none',
                      comingSoon ? 'opacity-70 cursor-not-allowed' : 'active:scale-95',
                      card.btnClass
                    )}
                  >
                    <BtnIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{card.btnLabel}</span>
                    {!comingSoon && <ArrowRight className="w-3.5 h-3.5 shrink-0 ml-auto" />}
                  </button>
                </div>
              </motion.div>
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
