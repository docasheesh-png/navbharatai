// THE CONVERSATION DESIGN EVERY AI IN NAVBHARATAI SHARES (admin 2026-10-13, verbatim: *"navbharatai ke
// sabhi ai ka font, headline etc bilkul claude jaisa karo! navbharatai ke sabhi ke chat wala ui aur ux
// ko claude jaisa karo!"*).
//
// "Like Claude" is taken as a SHAPE, not a brand — the proprietary faces, logo and name are not ours
// to ship (see index.css for the open faces chosen instead). The shape, in six rules:
//
//   1. ONE reading column, centred, `max-w-3xl`, with generous space between turns.
//   2. The USER's message is a soft tinted container on the right — never a loud accent fill with
//      white text (that is what every surface here used to do).
//   3. The ASSISTANT's reply is plain prose on the page: full width, no bubble, no border, no shadow.
//   4. Readable text — 15px at 1.65–1.7 — in place of the 11px bubbles and 7px uppercase labels.
//   5. No "YOU / NAVBHARATAI" captions, no timestamp under every line, no model badge (the White-Label
//      Law never allowed one). The thread reads as a conversation, not a log.
//   6. Actions (copy, retry, edit, report…) are quiet ghost icons under the message: shown on hover on
//      a pointer device, always on touch, where there is no hover to reveal them with.
//
// 🔑 THE CLASS, NOT THE INSTANCE. Five surfaces (free chat, Pro builder, professionals, Doctor AI, the
// IDE mini chat) each hand-rolled their bubbles — `bubbleTone.ts` had already found two of them drifting
// apart. The classes below are read by every one of them, so the look cannot drift again, and
// tests/theChatReadsLikeOneProduct.test.ts fails when a surface stops reading them.
//
// PRESENTATIONAL ONLY: class strings. Colours are tokens (THEME_RULES.md) — never a literal.

/** The centred reading column; the composer uses the same width so it lines up under the thread. */
export const CONVERSATION_COLUMN_CLASS = 'mx-auto w-full max-w-3xl';

/** A turn's wrapper. `group/msg` is what reveals the action row on hover. */
export const USER_TURN_CLASS = 'group/msg flex flex-col items-end';
export const ASSISTANT_TURN_CLASS = 'group/msg flex flex-col items-start';

/**
 * The user's own message: a soft container on the right, in the page's own ink. The hairline border is
 * for High contrast, where `bg-raised` is the page's own black and the container would otherwise vanish.
 *
 * ⚠️ No `whitespace-pre-wrap` here, on purpose: a message rendered through ChatMarkdown already turns
 * every newline into a break, and `pre-wrap` on top of react-markdown's output doubles every one of
 * them. A surface that renders PLAIN text adds `PLAIN_TEXT_CLASS` itself.
 */
export const USER_MESSAGE_CLASS =
  'max-w-[85%] bg-raised border border-line text-ink rounded-3xl px-4 py-2.5 text-[15px] leading-[1.65] break-words';

/** For a message rendered as plain text (not markdown): the author's line breaks, kept. */
export const PLAIN_TEXT_CLASS = 'whitespace-pre-wrap';

/**
 * Applied to a scroll container, keeps every turn in the reading column — the children are centred
 * and capped, so a surface's own list (an `AnimatePresence`, a notice, the greeting) needs no wrapper.
 */
export const CONVERSATION_COLUMN_CHILDREN_CLASS = '[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl';

/** The assistant's reply: prose on the page — no bubble. */
export const ASSISTANT_MESSAGE_CLASS = 'w-full text-body text-[15px] leading-[1.7] break-words';

/** The row of ghost actions under a message. */
export const MESSAGE_ACTION_ROW_CLASS =
  'mt-1 flex items-center gap-0.5 opacity-70 md:opacity-0 md:group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity';

/** One ghost action button, and the icon size it takes. */
export const MESSAGE_ACTION_BUTTON_CLASS = 'p-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors';
export const MESSAGE_ACTION_ICON_CLASS = 'w-4 h-4';

/** The one prose scale for markdown replies — defined in index.css, rendered by ChatMarkdown.tsx. */
export const CHAT_PROSE_CLASS = 'nb-prose';

/** The serif greeting headline and its quiet sub-line (Greeting.tsx). */
export const GREETING_CLASS = 'font-serif text-3xl sm:text-4xl font-normal tracking-tight text-ink';
export const GREETING_SUBLINE_CLASS = 'text-base text-muted';

/** A compact serif title for a surface's header (a professional's name, Doctor AI). */
export const SURFACE_TITLE_CLASS = 'font-serif text-lg font-medium tracking-tight text-ink';

/** The "thinking" indicator while a reply is on its way: three quiet dots, no bubble. */
export const TYPING_DOTS_CLASS = 'flex items-center gap-1 px-1 py-2';
export const TYPING_DOT_CLASS = 'w-1.5 h-1.5 rounded-full bg-muted animate-bounce';
