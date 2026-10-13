// The greeting an empty chat opens with — "Good evening, Asheesh" — in the serif headline (Greeting.tsx).
// PURE: hour and name in, words out. No clock, no auth, so it is testable at every boundary.

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Which part of the day an hour (0–23) belongs to. Noon starts the afternoon; five starts the evening. */
export function dayPartFor(hour: number): DayPart {
  const h = Number.isFinite(hour) ? Math.floor(hour) : 12;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}

/**
 * The name the greeting addresses: the first word of what the account calls itself, or nothing.
 *
 * Nothing is guessed from an email address — "Good evening, asheesh@gmail.com" is worse than no
 * name — and a very long first token is treated as not-a-name for the same reason. The result is
 * only ever shown inside a `<h1>` by React, which escapes it; nothing here needs to.
 */
export function greetingName(displayName: string | null | undefined): string | null {
  const raw = String(displayName ?? '').trim();
  if (!raw || raw.includes('@')) return null;
  const first = raw.split(/\s+/)[0] ?? '';
  if (!first || first.length > 24) return null;
  return first;
}

/** "Good morning, Asheesh" — or "Good morning" when the account has no usable name. */
export function greetingFor(hour: number, displayName?: string | null): string {
  const part = dayPartFor(hour);
  const name = greetingName(displayName);
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}
