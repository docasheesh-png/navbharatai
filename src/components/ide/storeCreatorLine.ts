// The creator corner of an App Mart card (admin 2026-09-27): name, public creator code, publish date.
//
// The date is written dd/mm/yy because that is how the admin asked for it ("22/09/24") and how dates
// are read in India. It is formatted from the viewer's own clock, and an unreadable timestamp yields
// null so the card prints nothing rather than "NaN/NaN/aN".

export function formatShortDate(ms: number | undefined | null): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)}`;
}

export interface CreatorLine {
  name: string | null;
  id: string | null;
  date: string | null;
}

/** What the corner shows. A field the server did not send stays null and is simply not drawn. */
export function creatorLine(app: { creatorName?: string; creatorId?: string; publishedAt?: number }): CreatorLine {
  const name = typeof app.creatorName === 'string' && app.creatorName.trim() ? app.creatorName.trim() : null;
  const id = typeof app.creatorId === 'string' && /^[a-z0-9]{4,32}$/.test(app.creatorId) ? app.creatorId : null;
  return { name, id, date: formatShortDate(app.publishedAt) };
}
