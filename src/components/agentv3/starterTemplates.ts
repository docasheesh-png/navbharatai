// AgentV3 — starter templates (cold-start killer), TIER-AWARE.
//
// A first-time user staring at an empty composer is the worst moment for "the world's best app builder":
// they don't know what to type, so they type something thin and get a thin app. This curated library gives
// one-tap, RICH starter prompts. Tapping one drops a detailed prompt into the composer that the user then
// customises and builds — it never auto-builds, so the user stays in control.
//
// TIER AWARENESS (admin-mandated 2026-08-02): a FREE (weak-tier) user must have a FIRST BUILD THAT WORKS —
// so a free user is only ever suggested `tier:'simple'` apps that the weak GLM/Kimi tier reliably builds
// end-to-end (todo, calculator, timer, notes, login page…). The ambitious `tier:'pro'` apps (SaaS
// dashboard, CRM, store, realtime social…) are the ones that flail on the weak tier — so a free user sees a
// curated few of them as LOCKED "⚡ Pro" showcases (tapping opens the upgrade surface), which both protects
// their first-build trust AND shows them exactly what upgrading unlocks. A paid/unlocked user sees the whole
// library, tappable, no locks. `partitionStarters()` is the single pure decision behind this.
//
// Pure data + tiny pure helpers (no React, no I/O) → fully unit-testable and dependency-free.

export interface StarterTemplate {
  /** Stable id (used as the React key + for any future analytics). */
  id: string;
  /** Short chip label shown in the picker. */
  label: string;
  /** A single emoji shown on the chip. */
  icon: string;
  /** Grouping bucket for the picker. */
  category: 'Business' | 'Social' | 'Productivity' | 'Commerce' | 'Personal';
  /** Capability tier this app needs to be built WELL. `simple` = the weak/free tier reliably ships it
   *  end-to-end; `pro` = it wants a paid tier (multi-role, backend, realtime, payments) to be good. */
  tier: 'simple' | 'pro';
  /** For `pro` templates only: surface this one to FREE users as a locked "⚡ Pro" showcase (the aspirational
   *  apps that drive an upgrade). Ignored for `simple` templates. */
  showcase?: boolean;
  /** The rich, specific prompt dropped into the composer. Detailed on purpose — it showcases the engine and
   *  gives the requirement-analyzer a real domain to build out fully. */
  prompt: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // SIMPLE — the weak/free tier builds these reliably in one pass. A free user is only ever offered these,
  // so their FIRST build works. Kept single-page, no backend/auth-server/realtime/payments (localStorage
  // at most) — exactly the shape the weak GLM/Kimi tier ships cleanly.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    id: 'todo', label: 'To-do', icon: '✅', category: 'Productivity', tier: 'simple',
    prompt: 'Build a to-do list app: add, edit, complete and delete tasks, organise them by category, filter by all/active/done, and save everything in the browser so it persists on reload. Clean, mobile-friendly UI with light/dark mode.',
  },
  {
    id: 'calculator', label: 'Calculator', icon: '🧮', category: 'Personal', tier: 'simple',
    prompt: 'Build a calculator app with the standard operations (+ − × ÷ %), a clear and a delete key, decimal support, keyboard input, and a running history of recent calculations. Big, tappable buttons; light/dark mode.',
  },
  {
    id: 'stopwatch', label: 'Stopwatch', icon: '⏱️', category: 'Personal', tier: 'simple',
    prompt: 'Build a stopwatch and countdown timer: start, pause and reset, lap times for the stopwatch, and a settable countdown that plays an alarm sound when it reaches zero. Large, easy-to-read display; mobile-first.',
  },
  {
    id: 'pomodoro', label: 'Pomodoro', icon: '🍅', category: 'Productivity', tier: 'simple',
    prompt: 'Build a Pomodoro focus timer: 25-minute work sessions and 5-minute breaks, start/pause/skip controls, a completed-session counter, and a gentle chime when a session ends. Calm, minimal, distraction-free UI.',
  },
  {
    id: 'tip-split', label: 'Bill split', icon: '💵', category: 'Personal', tier: 'simple',
    prompt: 'Build a tip calculator and bill splitter: enter the bill amount, pick a tip percentage (or type a custom one), split between any number of people, and instantly see the tip, the grand total and the amount each person pays.',
  },
  {
    id: 'unit-converter', label: 'Converter', icon: '📐', category: 'Productivity', tier: 'simple',
    prompt: 'Build a unit converter for length, weight and temperature (and currency with simple fixed rates): a from/to unit picker and instant conversion as you type, with a quick swap button. Clean, compact, mobile-first UI.',
  },
  {
    id: 'qr-generator', label: 'QR code', icon: '🔳', category: 'Productivity', tier: 'simple',
    prompt: 'Build a QR code generator: type any text or link and instantly see its QR code update, choose a size, and download it as an image with one tap. Simple, single-screen UI with light/dark mode.',
  },
  {
    id: 'quick-notes', label: 'Quick notes', icon: '🗒️', category: 'Productivity', tier: 'simple',
    prompt: 'Build a quick notes app: write short notes, pin the important ones to the top, search by text, and save everything in the browser so it persists on reload. Fast, distraction-free, mobile-first UI.',
  },
  {
    id: 'password-gen', label: 'Password', icon: '🔑', category: 'Personal', tier: 'simple',
    prompt: 'Build a password generator: choose the length with a slider and toggle uppercase, numbers and symbols, generate a strong random password, show a strength meter, and copy it to the clipboard with one tap.',
  },
  {
    id: 'memory', label: 'Memory match', icon: '🃏', category: 'Personal', tier: 'simple',
    prompt: 'Build a memory match card game: a 4x4 grid of face-down cards hiding eight pairs, flip two at a time, matched pairs stay face up, count the moves taken, celebrate when the board is cleared, and remember the best (lowest) score in the browser. Big tappable cards, smooth flip feel, light/dark mode, works on a phone.',
  },
  {
    id: 'puzzle', label: 'Merge puzzle', icon: '🧩', category: 'Personal', tier: 'simple',
    prompt: 'Build a sliding merge puzzle on a 4x4 grid: swipe or use arrow keys to slide every tile, two equal tiles merge into their double and add to the score, a new tile appears after each move, and the game ends when no move is left. Show the current score and the best score kept in the browser. Mobile-first with swipe support, light/dark mode.',
  },
  {
    id: 'login-page', label: 'Login page', icon: '🔐', category: 'Personal', tier: 'simple',
    prompt: 'Build a polished login and signup page: email and password fields with inline validation, a show/hide password toggle, a "remember me" option, social-login buttons, and a smooth switch between Login and Sign up. Front-end UI with light/dark mode.',
  },

  // INDIA-FIRST (2026-09-12). These two are the MOAT on the FREE tier: a GST bill with the CGST/SGST
  // split a shop actually has to print, and a mock test with sections and negative marking. Both are
  // one screen over plain React state, which is why the weak tier ships them whole.
  {
    id: 'gst-bill', label: 'GST bill', icon: '🏪', category: 'Business', tier: 'simple',
    prompt: 'Build a GST billing app for a shop: keep a list of items each with a price and a GST slab (0/5/12/18/28%), add items to a bill with quantities, and show the bill with taxable value, the CGST and SGST split per slab, and the final total in rupees. Auto-increment the bill number, allow a customer name, support printing the bill, and save the item list in the browser. Mobile-first with large tappable item buttons and light/dark mode.',
  },
  {
    id: 'exam-prep', label: 'Mock test', icon: '✍️', category: 'Personal', tier: 'simple',
    prompt: 'Build a mock test app for Indian competitive exam practice: a sectioned paper (General Knowledge, Reasoning, Quantitative Aptitude, English), one timer for the whole paper, four options per question, mark-for-review, a question palette to jump between questions, and negative marking of 0.25 for every wrong answer. Show a result screen with the section-wise score and a review of every question, and keep past attempts in the browser. Mobile-first, light/dark mode.',
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // PRO — ambitious, multi-part apps (roles, backends, realtime, payments). Great on a paid tier; they
  // flail on the weak tier. Shown fully to unlocked users; a curated `showcase` few appear LOCKED to free
  // users as the "⚡ Pro" upgrade carrot.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ── Business ──
  {
    id: 'arcade', label: 'Arcade game', icon: '🕹️', category: 'Personal', tier: 'pro', showcase: true,
    prompt: 'Build a playable arcade game on a canvas: the player moves left and right along the bottom while obstacles fall faster over time, dodging one scores a point, a hit costs a life, three lives end the run, and the best score is kept in the browser. Use a fixed-timestep game loop with a clamped delta and polled keyboard input so it runs identically on any screen, recycle obstacles from a pool instead of allocating each frame, and add on-screen buttons so it plays on a phone. Light/dark mode.',
  },
  {
    id: 'saas-dashboard', label: 'SaaS app', icon: '📊', category: 'Business', tier: 'pro', showcase: true,
    prompt: 'Build a multi-tenant SaaS admin dashboard with team accounts, role-based access (owner/admin/member), an analytics overview with charts, a settings page, and subscription billing. Clean, modern UI with a sidebar.',
  },
  {
    id: 'crm', label: 'CRM', icon: '🤝', category: 'Business', tier: 'pro', showcase: true,
    prompt: 'Build a CRM to manage contacts and a sales pipeline: kanban deal stages (lead → qualified → won/lost), contact profiles with activity history, notes and tasks, and a dashboard of pipeline value. Include search and filters.',
  },
  {
    id: 'invoicing', label: 'Invoices', icon: '🧾', category: 'Business', tier: 'pro',
    prompt: 'Build an invoicing app for a small business: create and send invoices with line items and GST/tax, track paid/unpaid/overdue status, a client list, and a dashboard of revenue and outstanding amounts. PDF-ready invoice view.',
  },
  // ── Commerce ──
  {
    id: 'store', label: 'Store', icon: '🛍️', category: 'Commerce', tier: 'pro', showcase: true,
    prompt: 'Build an online store with a product catalog (search, categories, filters), product pages, a cart and checkout, order history, and an admin panel to manage products and orders. Responsive, image-forward design.',
  },
  {
    id: 'restaurant', label: 'Restaurant', icon: '🍽️', category: 'Commerce', tier: 'pro', showcase: true,
    prompt: 'Build a restaurant app: a digital menu by category with photos and prices, table/takeaway ordering, kitchen order tickets, GST billing, and an admin area to manage the menu and view orders.',
  },
  {
    id: 'bookings', label: 'Bookings', icon: '📅', category: 'Commerce', tier: 'pro',
    prompt: 'Build an appointment-booking app: an availability calendar with time slots, booking with confirmation, reminders, a cancellation policy, and an admin dashboard of upcoming bookings. Works for a salon, clinic or consultant.',
  },
  // ── Social ──
  {
    id: 'social-feed', label: 'Social feed', icon: '💬', category: 'Social', tier: 'pro', showcase: true,
    prompt: 'Build a social app with user profiles, a realtime post feed, likes and comments, follow/unfollow, image upload, and notifications. Include content moderation/report and a clean mobile-first UI.',
  },
  {
    id: 'community', label: 'Forum', icon: '🗣️', category: 'Social', tier: 'pro',
    prompt: 'Build a community forum with topics and threaded discussions, upvotes, tags, user reputation, search, and moderation tools. A clean, readable, Reddit-style layout.',
  },
  {
    id: 'events', label: 'Events', icon: '🎟️', category: 'Social', tier: 'pro',
    prompt: 'Build an events platform: event listings with an agenda, ticket types with capacity, registration/RSVP, QR check-in, payments, and an organizer dashboard of attendees and sales.',
  },
  // ── Productivity ──
  {
    id: 'kanban', label: 'Task board', icon: '🗂️', category: 'Productivity', tier: 'pro',
    prompt: 'Build a project management app with boards, drag-and-drop kanban columns, cards with assignees/labels/due dates, comments, and a dashboard. Team workspaces with member invites.',
  },
  {
    id: 'notes', label: 'Docs', icon: '📝', category: 'Productivity', tier: 'pro',
    prompt: 'Build a note-taking app with a folder/tag sidebar, a rich-text editor, full-text search, pinning and favorites, and autosave. Fast, keyboard-friendly, distraction-free UI.',
  },
  {
    id: 'lms', label: 'Courses', icon: '🎓', category: 'Productivity', tier: 'pro',
    prompt: 'Build a learning platform (LMS): courses with lessons and content, enrolment, quizzes with auto-grading, progress tracking, and separate student/teacher/admin roles. Include a course catalog and a student dashboard.',
  },
  // ── Personal ──
  {
    id: 'portfolio', label: 'Portfolio', icon: '🌐', category: 'Personal', tier: 'pro',
    prompt: 'Build a personal portfolio website: a hero intro, a projects gallery with detail pages, an about section, a skills list, and a contact form. Polished, animated, responsive, with light/dark mode.',
  },
  {
    id: 'fitness', label: 'Fitness', icon: '💪', category: 'Personal', tier: 'pro',
    prompt: 'Build a fitness app: log workouts and track progress over time with charts, set goals, browse exercise routines, and (for a gym) membership and class scheduling with trainer assignment.',
  },
  {
    id: 'expense', label: 'Expenses', icon: '💸', category: 'Personal', tier: 'pro',
    prompt: 'Build a personal finance app: add income and expenses by category, monthly budgets with progress, charts of spending trends, and a dashboard with balance and top categories. Clean, reassuring UI.',
  },
  // INDIA-FIRST, pro tier: both are several LINKED records (flats to dues, students to batches to
  // fees), which is exactly the shape a weak model half-builds.
  {
    id: 'society', label: 'Society', icon: '🏢', category: 'Business', tier: 'pro', showcase: true,
    prompt: 'Build a housing society and RWA management app: flats with owner name, phone and block; monthly maintenance dues per flat that can be raised for the whole society in one action and then marked paid; a notice board; and resident complaints with open, in-progress and closed status. A dashboard showing total flats, amount collected this month, amount pending and open complaints. Rupee amounts throughout, a mobile-friendly sidebar layout, and light/dark mode.',
  },
  {
    id: 'coaching', label: 'Coaching', icon: '📚', category: 'Business', tier: 'pro',
    prompt: 'Build a coaching class management app: batches with subject, timing and monthly fee; students assigned to a batch with a phone number; daily attendance taken batch by batch with an attendance percentage per student; and monthly fees raised for every student at their own batch rate, marked paid or pending. A dashboard showing students, batches, fees collected this month, fees pending and any student below 75% attendance. Rupee amounts throughout, a mobile-friendly sidebar layout, and light/dark mode.',
  },
];

/** Group the starters by category, preserving array order within each group. Pure. */
export function startersByCategory(list: readonly StarterTemplate[] = STARTER_TEMPLATES): Array<{ category: StarterTemplate['category']; items: StarterTemplate[] }> {
  const order: StarterTemplate['category'][] = ['Business', 'Commerce', 'Social', 'Productivity', 'Personal'];
  const byCat = new Map<StarterTemplate['category'], StarterTemplate[]>();
  for (const t of list) {
    const arr = byCat.get(t.category) ?? [];
    arr.push(t);
    byCat.set(t.category, arr);
  }
  return order.filter((c) => byCat.has(c)).map((category) => ({ category, items: byCat.get(category)! }));
}

export interface StarterPartition {
  /** Chips the user can tap to drop the prompt into the composer. */
  tappable: StarterTemplate[];
  /** `pro` showcases shown LOCKED to a free user (tapping opens the upgrade surface). Empty for unlocked users. */
  locked: StarterTemplate[];
}

/**
 * Decide which starters a user is offered, given whether their account is unlocked for the paid tiers.
 *   • Unlocked (paid / free-list): the WHOLE library is tappable; nothing is locked.
 *   • Free (weak-tier only): only `simple` apps are tappable (so their first build actually works), and the
 *     curated `pro` + `showcase` apps are returned as LOCKED upgrade carrots.
 * Pure — no React, no I/O — so it is fully unit-testable.
 */
export function partitionStarters(powerUnlocked: boolean, list: readonly StarterTemplate[] = STARTER_TEMPLATES): StarterPartition {
  if (powerUnlocked) return { tappable: list.slice(), locked: [] };
  return {
    tappable: list.filter((t) => t.tier === 'simple'),
    locked: list.filter((t) => t.tier === 'pro' && t.showcase === true),
  };
}
