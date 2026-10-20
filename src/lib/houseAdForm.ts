// The pure half of the admin's Ads form: what the form holds, how it becomes the request body, and how an
// ad's status and dates are worded (admin house ads, 2026-10-20). No React, no fetch, so every rule here is a
// plain unit test and `admin/AdsPanel.tsx` is left with only the screen.

import { HOUSE_AD_PLACEMENTS, type HouseAdPlacement, type HouseAdStatus, type HouseAdView } from './houseAds';

export type AdRow = HouseAdView & { status: HouseAdStatus };

export interface FormState {
  editingId: string | null;
  name: string;
  description: string;
  linkUrl: string;
  placements: HouseAdPlacement[];
  enabled: boolean;
  /** `YYYY-MM-DD` from the date inputs; '' = none. */
  startDate: string;
  endDate: string;
  /** The freshly cropped picture (a data URL), or null = keep the stored one when editing. */
  imageDataUrl: string | null;
  /** What the preview draws: the new picture, or the stored one when editing. */
  previewUrl: string | null;
}

export const emptyForm = (): FormState => ({
  editingId: null, name: '', description: '', linkUrl: '', placements: [...HOUSE_AD_PLACEMENTS], enabled: true,
  startDate: '', endDate: '', imageDataUrl: null, previewUrl: null,
});

const pad = (n: number) => String(n).padStart(2, '0');
/** ms → the local `YYYY-MM-DD` a date input shows. */
export const toDateInput = (ms: number | null) => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** `YYYY-MM-DD` → local midnight (ms), or null. */
export const fromDateInput = (v: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
};
/** The local midnight AFTER a `YYYY-MM-DD` day — the day's exclusive end. Built from calendar fields, never `+ 24 h`,
 *  because a day is not always 24 hours where a daylight-saving change falls. */
export const nextDayStart = (v: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() : null;
};
/** The last whole day an ad is shown, given its stored (exclusive) end: one millisecond before that midnight. */
export const lastDayShown = (endsAt: number): number => endsAt - 1;
export const fmtDate = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));

export const STATUS_VIEW: Record<HouseAdStatus, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'text-success' },
  off: { label: 'Off', tone: 'text-muted' },
  scheduled: { label: 'Scheduled', tone: 'text-info' },
  ended: { label: 'Ended', tone: 'text-warn' },
};

/** The body the server receives. `endDate` is INCLUSIVE in the form, so the stored end is the next local midnight. */
export function adBodyFromForm(f: FormState): Record<string, unknown> {
  const start = fromDateInput(f.startDate);
  const body: Record<string, unknown> = {
    name: f.name, description: f.description, linkUrl: f.linkUrl.trim() || null, placements: f.placements,
    enabled: f.enabled, startsAt: start, endsAt: nextDayStart(f.endDate),
  };
  if (f.imageDataUrl) body.imageDataUrl = f.imageDataUrl;
  return body;
}

