// AgentV3 — starter templates (cold-start killer).
//
// A first-time user staring at an empty composer is the worst moment for "the world's best app builder":
// they don't know what to type, so they type something thin and get a thin app. This curated library gives
// one-tap, RICH starter prompts across the domains the engine builds best (and that its requirement-
// awareness fills out automatically). Tapping one drops a detailed prompt into the composer that the user
// then customises and builds — it never auto-builds, so the user stays in control.
//
// Pure data + a tiny grouping helper (no React, no I/O) → fully unit-testable and dependency-free.

export interface StarterTemplate {
  /** Stable id (used as the React key + for any future analytics). */
  id: string;
  /** Short chip label shown in the picker. */
  label: string;
  /** A single emoji shown on the chip. */
  icon: string;
  /** Grouping bucket for the picker. */
  category: 'Business' | 'Social' | 'Productivity' | 'Commerce' | 'Personal';
  /** The rich, specific prompt dropped into the composer. Detailed on purpose — it showcases the engine
   *  and gives the requirement-analyzer a real domain to build out fully. */
  prompt: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // ── Business ──
  {
    id: 'saas-dashboard', label: 'SaaS dashboard', icon: '📊', category: 'Business',
    prompt: 'Build a multi-tenant SaaS admin dashboard with team accounts, role-based access (owner/admin/member), an analytics overview with charts, a settings page, and subscription billing. Clean, modern UI with a sidebar.',
  },
  {
    id: 'crm', label: 'CRM / pipeline', icon: '🤝', category: 'Business',
    prompt: 'Build a CRM to manage contacts and a sales pipeline: kanban deal stages (lead → qualified → won/lost), contact profiles with activity history, notes and tasks, and a dashboard of pipeline value. Include search and filters.',
  },
  {
    id: 'invoicing', label: 'Invoicing app', icon: '🧾', category: 'Business',
    prompt: 'Build an invoicing app for a small business: create and send invoices with line items and GST/tax, track paid/unpaid/overdue status, a client list, and a dashboard of revenue and outstanding amounts. PDF-ready invoice view.',
  },
  // ── Commerce ──
  {
    id: 'store', label: 'Online store', icon: '🛍️', category: 'Commerce',
    prompt: 'Build an online store with a product catalog (search, categories, filters), product pages, a cart and checkout, order history, and an admin panel to manage products and orders. Responsive, image-forward design.',
  },
  {
    id: 'restaurant', label: 'Restaurant / menu', icon: '🍽️', category: 'Commerce',
    prompt: 'Build a restaurant app: a digital menu by category with photos and prices, table/takeaway ordering, kitchen order tickets, GST billing, and an admin area to manage the menu and view orders.',
  },
  {
    id: 'bookings', label: 'Booking / appointments', icon: '📅', category: 'Commerce',
    prompt: 'Build an appointment-booking app: an availability calendar with time slots, booking with confirmation, reminders, a cancellation policy, and an admin dashboard of upcoming bookings. Works for a salon, clinic or consultant.',
  },
  // ── Social ──
  {
    id: 'social-feed', label: 'Social feed', icon: '💬', category: 'Social',
    prompt: 'Build a social app with user profiles, a realtime post feed, likes and comments, follow/unfollow, image upload, and notifications. Include content moderation/report and a clean mobile-first UI.',
  },
  {
    id: 'community', label: 'Community forum', icon: '🗣️', category: 'Social',
    prompt: 'Build a community forum with topics and threaded discussions, upvotes, tags, user reputation, search, and moderation tools. A clean, readable, Reddit-style layout.',
  },
  {
    id: 'events', label: 'Event platform', icon: '🎟️', category: 'Social',
    prompt: 'Build an events platform: event listings with an agenda, ticket types with capacity, registration/RSVP, QR check-in, payments, and an organizer dashboard of attendees and sales.',
  },
  // ── Productivity ──
  {
    id: 'kanban', label: 'Project board', icon: '🗂️', category: 'Productivity',
    prompt: 'Build a project management app with boards, drag-and-drop kanban columns, cards with assignees/labels/due dates, comments, and a dashboard. Team workspaces with member invites.',
  },
  {
    id: 'notes', label: 'Notes / docs', icon: '📝', category: 'Productivity',
    prompt: 'Build a note-taking app with a folder/tag sidebar, a rich-text editor, full-text search, pinning and favorites, and autosave. Fast, keyboard-friendly, distraction-free UI.',
  },
  {
    id: 'lms', label: 'Learning platform', icon: '🎓', category: 'Productivity',
    prompt: 'Build a learning platform (LMS): courses with lessons and content, enrolment, quizzes with auto-grading, progress tracking, and separate student/teacher/admin roles. Include a course catalog and a student dashboard.',
  },
  // ── Personal ──
  {
    id: 'portfolio', label: 'Portfolio site', icon: '🌐', category: 'Personal',
    prompt: 'Build a personal portfolio website: a hero intro, a projects gallery with detail pages, an about section, a skills list, and a contact form. Polished, animated, responsive, with light/dark mode.',
  },
  {
    id: 'fitness', label: 'Fitness tracker', icon: '💪', category: 'Personal',
    prompt: 'Build a fitness app: log workouts and track progress over time with charts, set goals, browse exercise routines, and (for a gym) membership and class scheduling with trainer assignment.',
  },
  {
    id: 'expense', label: 'Expense tracker', icon: '💸', category: 'Personal',
    prompt: 'Build a personal finance app: add income and expenses by category, monthly budgets with progress, charts of spending trends, and a dashboard with balance and top categories. Clean, reassuring UI.',
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
