// The conversations, on the screen the app opens on — not behind a button.
//
// ADMIN 2026-09-17: *"old session kis button ke piche hide na ho"*. Until now every past
// conversation needed a press to find: History (a popup over the Free chat), or the hamburger and
// then History, or — for a professional — the Professionals hub and then its own history screen.
//
// 🔴 THIS IS NOT THE "RECENT CHATS" BLOCK THE ADMIN HAD REMOVED IN JULY. That one (PR #799, removed
// in `ca8b6786` — *"isko hata do, koi matalb ka nahi hai"*) was the last 8 chats pinned to the
// BOTTOM OF THE HAMBURGER MENU: behind a button, inside a menu, under the navigation, every second
// row titled "New Conversation". It made nothing discoverable and resumed nothing. The reasoning
// for why this is a different thing lives in `lib/recentConversations.ts`, next to the merge rules.
//
// 🔒 IT RENDERS NOTHING WHEN THERE IS NOTHING. A first-time visitor sees the page exactly as before
// — an empty "Recent conversations" panel on a landing page is an advertisement for a feature the
// person has not used yet.

import React from 'react';
import { MessageSquare, Bot, Stethoscope, Sparkles, ArrowRight } from 'lucide-react';
import { timeAgo } from '../../lib/publishFreshness';
import type { RecentConversation, RecentKind } from '../../lib/recentConversations';

const KIND_ICON: Record<RecentKind, React.ComponentType<{ className?: string }>> = {
  free: MessageSquare,
  pro: Bot,
  doctor: Stethoscope,
  professional: Sparkles,
};

/** One accent per surface, so a glance tells you which of the app's chats a row belongs to. */
const KIND_ACCENT: Record<RecentKind, string> = {
  free: 'text-orange-400 bg-orange-500/15 border-orange-500/25',
  pro: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/25',
  doctor: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25',
  professional: 'text-sky-300 bg-sky-500/15 border-sky-500/25',
};

export interface RecentConversationsProps {
  items: readonly RecentConversation[];
  /** Open one. The caller owns HOW — a session restores by id, a professional is made live first. */
  onOpen: (item: RecentConversation) => void;
  /** Injected so the rendered times are stable under test rather than reading the wall clock. */
  now?: number;
}

export const RecentConversations: React.FC<RecentConversationsProps> = ({ items, onOpen, now }) => {
  if (!items || items.length === 0) return null;
  const at = typeof now === 'number' ? now : Date.now();

  return (
    <section className="w-full" aria-labelledby="recent-conversations-heading">
      <div className="flex items-baseline gap-2 mb-2.5 px-0.5">
        <h2
          id="recent-conversations-heading"
          className="text-[11px] sm:text-xs font-black uppercase tracking-[0.18em] text-[#8b949e]"
        >
          Continue where you left off
        </h2>
      </div>

      {/* A LIST, not a horizontal carousel. A row people are meant to recognise needs its title
          readable in full; a side-scrolling strip truncates every one of them to a few words and
          hides the rest behind a gesture — which is the "behind a button" problem again, wearing
          a different shape. */}
      <ul className="w-full flex flex-col gap-1.5" role="list">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind] ?? MessageSquare;
          const accent = KIND_ACCENT[item.kind] ?? KIND_ACCENT.free;
          // "Ongoing" is the honest word for a conversation whose store keeps no timestamp — see
          // `RecentConversation.at`. Never a fabricated date.
          const when = item.at === null ? 'Ongoing' : timeAgo(item.at, at);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="group w-full flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-white/25 hover:bg-white/[0.07] touch-manipulation"
              >
                <span className={`shrink-0 rounded-xl border p-2 ${accent}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white leading-tight truncate">
                    {item.title}
                  </span>
                  <span className="block text-[11px] text-[#8b949e] leading-snug mt-0.5 truncate">
                    {item.tag} · {when}
                  </span>
                </span>
                <ArrowRight className="w-4 h-4 text-white/30 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
