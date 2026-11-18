import type { Request } from 'express';
import { adminRequestOk } from './adminAuth';

/** Caller must supply an already-verified identity. Credits/free-build grants are not authority. */
export function explicitStoreAdmin(verifiedEmail: string | null, configuredAdmins: string | undefined): boolean {
  if (!verifiedEmail) return false;
  const allowed = (configuredAdmins || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(verifiedEmail.toLowerCase());
}

/**
 * WHO MAY MODERATE THE APP MART — the one decision every store, social and gallery admin route asks (owner 2026-11-18:
 * "admin jab app mart open kare, to … ek 4th option 'manage apps' … yeh system pahle tha, ab band ho gaya").
 *
 * 🔴 WHY THE REVIEW TAB VANISHED. The store recognised ONE kind of admin — a verified email listed in
 * `NAV_STORE_ADMINS` — while the rest of the platform recognises another: the signed admin session (password + MFA,
 * `adminRequestOk`) that shows "Admin Panel" in the profile menu. #4191 rightly removed the `AGENTV3_FREE_LIST`
 * fallback (a free-build grant is not authority), and from then on an owner signed in with an account that is not in
 * that one env list saw Admin Panel but no Review tab: two admin lists, drifted apart.
 *
 * THE RULE: an active admin session IS store authority (it is the strongest proof the platform has — stronger than an
 * email list), and the explicit allowlist still works for a named reviewer without the panel password. Free-build and
 * credit grants remain no authority at all.
 */
export function storeAdminRequest(req: Request, verifiedEmail: string | null): boolean {
  return adminRequestOk(req) || explicitStoreAdmin(verifiedEmail, process.env.NAV_STORE_ADMINS);
}
