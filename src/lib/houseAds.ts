// HOUSE ADS — the admin's own products, shown to people who have not paid (admin 2026-10-20).
//
// The admin asked for one thing: "admin panel me ads ka option — admin apne kisi saman ka ads chala
// sake: naam, description aur photo upload kare, aur user ko woh ads dikhne lage." This file is the
// part of that which BOTH sides must agree on — what an ad is, where it may appear, what a valid one
// looks like and which one is picked — so the admin form, the server and the screens a user sees can
// never disagree about it. PURE: no React, no fetch, no Firestore.
//
// 🔒 WHAT AN AD IS NOT. It is not a third-party network and it carries no tracking: the only thing
// stored is what the admin typed and the picture they uploaded. The Privacy Policy says NavBharatAI
// shows no THIRD-PARTY advertising inside the product, and that sentence stays true only while every
// ad here is the operator's own — which is why the admin form says "your own product".
//
// 🔒 WHO NEVER SEES ONE. A paid account (real money spent, or an active hosting plan) — decided on the
// server in `houseAdAudience.ts`, never in a client, because the hosting plan's own copy promises
// "keeps NavBharatAI ad-free for you".

/**
 * Every surface an ad can be placed on. The admin ticks these per ad.
 *
 * 🔴 THE SERVER-RENDERED PUBLIC PAGES (/ai-app-builder, /pricing, …) ARE DELIBERATELY NOT HERE. The admin asked for
 * a banner on them, but those pages are static HTML for crawlers ("no script runs here") that CANNOT tell who is
 * reading: a paying customer opening /pricing would be shown an ad, which breaks the admin's own rule that paid
 * accounts never see one — and the hosting plan's screens, which promise "ad-free". A tick box for a place that
 * does nothing would be a control that lies, so the place is absent until it can be built honestly (an open item
 * in PROGRESS.md names the options).
 */
export const HOUSE_AD_PLACEMENTS = [
  'mart_tile',       // App Mart: a "Sponsored" tile between the app tiles
  'dashboard',       // Home: one small banner at the bottom (web and the phone app)
  'publish_success', // Publish / post-to-App-Mart success: a small banner BELOW the message, never an overlay
  'mart_banner',     // App Mart: a bottom banner, phone app only
] as const;

export type HouseAdPlacement = (typeof HOUSE_AD_PLACEMENTS)[number];

export const PLACEMENT_INFO: Readonly<Record<HouseAdPlacement, { label: string; where: string }>> = {
  mart_tile: { label: 'App Mart tile', where: 'A "Sponsored" tile between the app tiles in App Mart.' },
  dashboard: { label: 'Home banner', where: 'A small banner at the bottom of Home, on the web and in the phone app.' },
  publish_success: { label: 'After publishing', where: 'A small banner below the success message after a publish or an App Mart post.' },
  mart_banner: { label: 'App Mart banner (phone app)', where: 'A banner at the bottom of App Mart, in the phone app only.' },
};

export function isHouseAdPlacement(v: unknown): v is HouseAdPlacement {
  return typeof v === 'string' && (HOUSE_AD_PLACEMENTS as readonly string[]).includes(v);
}

export const HOUSE_AD_NAME_MAX = 60;
export const HOUSE_AD_DESCRIPTION_MAX = 160;
export const HOUSE_AD_LINK_MAX = 500;
/** The picture is cropped to this shape in the browser before upload, so the preview IS what users see. */
export const HOUSE_AD_IMAGE_WIDTH = 1200;
export const HOUSE_AD_IMAGE_HEIGHT = 300;
/** Decoded bytes. A Firestore document holds 1 MiB, and the picture travels inside it as a data URL. */
export const HOUSE_AD_IMAGE_MAX_BYTES = 300 * 1024;
export const HOUSE_AD_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** More than this many ads at once is a mistake, not a campaign. */
export const HOUSE_AD_MAX_COUNT = 30;

/** What the admin sends. The picture is `imageDataUrl`, and it may be left out when EDITING. */
export interface HouseAdInput {
  name: string;
  description: string;
  linkUrl: string | null;
  placements: HouseAdPlacement[];
  enabled: boolean;
  /** ms since epoch; null = no start / no end. */
  startsAt: number | null;
  endsAt: number | null;
  imageDataUrl?: string;
}

/** One ad as stored, with the picture served from its own URL rather than carried inside every list. */
export interface HouseAdView {
  id: string;
  name: string;
  description: string;
  linkUrl: string | null;
  placements: HouseAdPlacement[];
  enabled: boolean;
  startsAt: number | null;
  endsAt: number | null;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
}

/** What a user's screen receives: no admin fields, nothing it does not draw. */
export interface ServedHouseAd {
  id: string;
  name: string;
  description: string;
  linkUrl: string | null;
  imageUrl: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The one place a link is judged. `https:` only, no embedded credentials — it ends up in an `href`. */
export function cleanHttpsLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > HOUSE_AD_LINK_MAX) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  return u.toString();
}

const asTimeOrNull = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 'bad';
};

/**
 * Judge what the admin typed. The server calls this FIRST, so a typo is answered even when the
 * database is not. `requireImage` is true on create and false on edit (an edit that sends no picture
 * keeps the old one).
 */
export function parseHouseAdInput(body: unknown, opts: { requireImage: boolean }): ParseResult<HouseAdInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, error: 'Give the ad a name.' };
  if (name.length > HOUSE_AD_NAME_MAX) return { ok: false, error: `The name can be at most ${HOUSE_AD_NAME_MAX} characters.` };

  const description = typeof b.description === 'string' ? b.description.trim().replace(/\s+/g, ' ') : '';
  if (!description) return { ok: false, error: 'Write a short description.' };
  if (description.length > HOUSE_AD_DESCRIPTION_MAX) return { ok: false, error: `The description can be at most ${HOUSE_AD_DESCRIPTION_MAX} characters.` };

  let linkUrl: string | null = null;
  if (typeof b.linkUrl === 'string' && b.linkUrl.trim()) {
    linkUrl = cleanHttpsLink(b.linkUrl);
    if (!linkUrl) return { ok: false, error: 'The link must be a full https:// address, for example https://yourshop.in/offer.' };
  }

  const rawPlacements = Array.isArray(b.placements) ? b.placements : [];
  const placements = HOUSE_AD_PLACEMENTS.filter((p) => rawPlacements.includes(p));
  if (rawPlacements.some((p) => !isHouseAdPlacement(p))) return { ok: false, error: 'One of the chosen places is not a real place.' };
  if (placements.length === 0) return { ok: false, error: 'Choose at least one place for the ad to appear.' };

  if (typeof b.enabled !== 'boolean') return { ok: false, error: 'Say whether the ad is on or off.' };

  const startsAt = asTimeOrNull(b.startsAt);
  const endsAt = asTimeOrNull(b.endsAt);
  if (startsAt === 'bad' || endsAt === 'bad') return { ok: false, error: 'The start or end date is not a real date.' };
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) return { ok: false, error: 'The end date must be after the start date.' };

  const value: HouseAdInput = { name, description, linkUrl, placements, enabled: b.enabled, startsAt, endsAt };

  if (b.imageDataUrl !== undefined && b.imageDataUrl !== null && b.imageDataUrl !== '') {
    if (typeof b.imageDataUrl !== 'string') return { ok: false, error: 'The picture could not be read.' };
    value.imageDataUrl = b.imageDataUrl;
  } else if (opts.requireImage) {
    return { ok: false, error: 'Upload a picture for the ad.' };
  }
  return { ok: true, value };
}

/** Is this ad inside its dates? An ad with no dates is always inside. */
export function adInWindow(ad: { startsAt: number | null; endsAt: number | null }, nowMs: number): boolean {
  if (ad.startsAt !== null && nowMs < ad.startsAt) return false;
  if (ad.endsAt !== null && nowMs >= ad.endsAt) return false;
  return true;
}

/** The status the admin's table prints. ONE function, so the table can never say "Live" about an ad nobody is shown. */
export type HouseAdStatus = 'live' | 'off' | 'scheduled' | 'ended';

export function houseAdStatus(ad: { enabled: boolean; startsAt: number | null; endsAt: number | null }, nowMs: number): HouseAdStatus {
  if (!ad.enabled) return 'off';
  if (ad.startsAt !== null && nowMs < ad.startsAt) return 'scheduled';
  if (ad.endsAt !== null && nowMs >= ad.endsAt) return 'ended';
  return 'live';
}

/**
 * Pick the ad one screen shows. Only LIVE ads for that placement compete, and a random one wins so
 * two ads share a place instead of the first-created owning it. `rand` is injectable for tests.
 */
export function pickHouseAd<T extends { enabled: boolean; startsAt: number | null; endsAt: number | null; placements: readonly string[] }>(
  ads: readonly T[], placement: HouseAdPlacement, nowMs: number, rand: () => number = Math.random,
): T | null {
  const eligible = ads.filter((a) => houseAdStatus(a, nowMs) === 'live' && a.placements.includes(placement));
  if (eligible.length === 0) return null;
  const i = Math.min(eligible.length - 1, Math.floor(rand() * eligible.length));
  return eligible[i];
}

/**
 * The server's answer is not the ad until it is checked: `res.ok` plus this, at the one place the body
 * enters state. Anything that does not have the exact shape (or whose link is not a safe https link)
 * is NO ad — never a half-drawn one.
 */
export function parseServedHouseAd(body: unknown): ServedHouseAd | null {
  const ad = (body && typeof body === 'object' ? (body as Record<string, unknown>).ad : null) as Record<string, unknown> | null;
  if (!ad || typeof ad !== 'object') return null;
  const { id, name, description, imageUrl } = ad;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || typeof description !== 'string' || !description) return null;
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/api/ads/image/')) return null;
  let linkUrl: string | null = null;
  if (ad.linkUrl !== null && ad.linkUrl !== undefined) {
    linkUrl = cleanHttpsLink(ad.linkUrl);
    if (!linkUrl) return null;
  }
  return { id, name, description, linkUrl, imageUrl };
}
