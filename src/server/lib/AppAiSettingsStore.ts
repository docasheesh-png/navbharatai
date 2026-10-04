// THE OWNER'S SWITCH for NavBharatAI's AI inside their app (admin 2026-10-04: "keys and secret se user jab
// chahe navbharatai ki api delete kar de").
//
// One document per workspace in `app_ai_settings`. `disabled: true` switches the app's NavBharatAI
// assistant off EVERYWHERE at once — the published app (the gateway refuses it) and the preview — with no
// republish, because the token already sitting in visitors' browsers is checked against this on every
// call. Switching it back on is the same click. The owner's OWN key (appAiOwnKey.ts) is a separate choice
// and is not affected by this switch: "NavBharatAI's AI off" means our engine and our wallet charge stop.
//
// 🔒 AN UNREADABLE SETTING IS "ON", NOT "OFF", and that is the deliberate direction: a Firestore hiccup must
// not take every published assistant down at once — the caps are what bound the spend either way. The
// owner's explicit "off" is honoured from the moment it is written (this instance's cache is updated on
// write; another instance sees it within CACHE_MS).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export const APP_AI_SETTINGS_COLLECTION = 'app_ai_settings';
const CACHE_MS = 30_000;

export interface AppAiSettings {
  /** True when the owner switched NavBharatAI's AI off for this app. */
  disabled: boolean;
  updatedAt: number;
}

const cache = new Map<string, { s: AppAiSettings; at: number }>();
/** Test seam: under VITEST there is no Firestore, so the cache IS the store. */
const memory = new Map<string, AppAiSettings>();

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try { return getServerDb(); } catch { return null; }
}

export async function getAppAiSettings(workspaceId: string): Promise<AppAiSettings> {
  const off: AppAiSettings = { disabled: false, updatedAt: 0 };
  if (!workspaceId) return off;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.s;
  const d = db();
  if (!d) return memory.get(workspaceId) ?? off;
  try {
    const snap = await d.collection(APP_AI_SETTINGS_COLLECTION).doc(workspaceId).get();
    const data = (snap.exists ? snap.data() : null) as Partial<AppAiSettings> | null;
    const s: AppAiSettings = { disabled: data?.disabled === true, updatedAt: Number(data?.updatedAt) || 0 };
    cache.set(workspaceId, { s, at: Date.now() });
    return s;
  } catch {
    return off;
  }
}

/** Write the owner's choice. Returns false when it did not land (the caller must say so). */
export async function setAppAiDisabled(workspaceId: string, disabled: boolean): Promise<boolean> {
  if (!workspaceId) return false;
  const s: AppAiSettings = { disabled, updatedAt: Date.now() };
  const d = db();
  if (!d) { memory.set(workspaceId, s); cache.set(workspaceId, { s, at: Date.now() }); return true; }
  try {
    await d.collection(APP_AI_SETTINGS_COLLECTION).doc(workspaceId).set({ ...s, workspaceId }, { merge: true });
    cache.set(workspaceId, { s, at: Date.now() });
    return true;
  } catch (e) {
    console.error(`[APPAI] could not save the AI setting for ${workspaceId}:`, e);
    return false;
  }
}

export function __resetAppAiSettings(): void { cache.clear(); memory.clear(); }
