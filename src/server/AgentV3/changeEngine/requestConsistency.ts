// CHANGE ENGINE slice 5 — is this request consistent with what the app already promises? The one conflict
// that matters most: the user is deliberately REMOVING something the ledger says must keep working.
//
// WHY (2026-10-04). Slices 1–2 re-probe every verified requirement and restore one an edit lost. That is
// exactly right for an accident and exactly wrong for an instruction: "remove the delete button" would be
// built, re-probed as a regression, and then put BACK by the heal — the engine overruling the user. So
// before the build, the request is read against the ledger, and a requirement the user is plainly asking to
// remove leaves the ledger (status `dropped`, id kept) instead of being defended.
//
// Precision-first, like every reader of the user's words here: a removal verb must sit right next to the
// feature's own words ("remove the delete button", "search bar hata do", "get rid of login"). A sentence
// that merely contains both somewhere ("delete the old tasks, and keep the search") does not drop search.
// A miss costs one heal the user can undo by repeating the instruction; a false drop would silently stop
// defending a working feature, so the bar is high.
//
// PURE.

import { requestedProbeFeatures } from '../FeaturePresence';
import type { AppSpec, SpecItem } from './appSpec';

/** Verbs that remove, BEFORE the thing removed (English). */
const REMOVE_BEFORE = /(?<!\b(?:the|a|an|this|that|each|every)\s)\b(?:remove|delete|hide|drop|disable|get rid of|take out|take away|strip out|turn off|don'?t show|do not show|no longer show|stop showing)\s+/gi;
/** Verbs that remove, AFTER the thing removed (Hinglish word order). */
const REMOVE_AFTER = /\s+(?:hata do|hatao|hata de|hataa do|nikal do|nikalo|mat dikhao|band karo|band kar do|remove karo|remove kar do|delete karo|delete kar do|hide karo)\b/gi;
/** A piece of UI, or a word that is a whole feature on its own. */
const UI_NOUN = /\b(?:button|btn|bar|box|field|option|feature|section|tab|tabs|link|icon|toggle|switch|checkbox|menu|form|input|control|panel|page|screen|search|login|log ?in|sign ?in|sign ?up|filter|filters|dark ?mode|theme|list)\b/i;
/** How many words on the far side of the verb may still name its object. */
const WINDOW_WORDS = 5;

/** Where an object phrase ends: a clause boundary, or a place/time word ("from the list", "after 30 days"). */
const OBJECT_END = /[.,;!?]|\b(?:and|but|aur|lekin|then|from|in|on|at|after|before|inside|under|within|when|if|so|because)\b/i;

function wordsAfter(text: string, idx: number): string {
  return text.slice(idx).split(/\s+/).slice(0, WINDOW_WORDS).join(' ').split(OBJECT_END)[0];
}

function wordsBefore(text: string, idx: number): string {
  const parts = text.slice(0, idx).split(/[.,;!?]|\b(?:and|but|aur|lekin|then)\b/i);
  return (parts[parts.length - 1] || '').split(/\s+/).slice(-WINDOW_WORDS).join(' ');
}

/** The object phrases a removal verb points at. */
export function removalObjects(request: string): string[] {
  const text = typeof request === 'string' ? request : '';
  const out: string[] = [];
  for (const m of text.matchAll(REMOVE_BEFORE)) out.push(wordsAfter(text, (m.index ?? 0) + m[0].length));
  for (const m of text.matchAll(REMOVE_AFTER)) out.push(wordsBefore(text, m.index ?? 0));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * The probe-able features this request deliberately REMOVES ("remove the delete button" → delete). These
 * are NOT requested features, whatever the keyword reader says: "remove" is itself the delete probe's
 * keyword, so without this set the coverage check graded the removal as a missing Delete control and the
 * feature heal could put it back.
 */
export function removedProbeFeatures(request: string): Set<string> {
  const hit = new Set<string>();
  for (const o of removalObjects(request)) {
    // "remove completed tasks" is an action on DATA, not the removal of a feature — an object only names a
    // feature when it also names a piece of UI (or IS a whole feature: search, login, dark mode, filter).
    if (!UI_NOUN.test(o)) continue;
    for (const f of requestedProbeFeatures(o)) {
      // `list` fires on any item noun ("tasks", "notes"); only the word "list" itself removes the list.
      if (f.feature === 'list' && !/\blist\b/i.test(o)) continue;
      hit.add(f.feature);
    }
  }
  return hit;
}

/**
 * The live ledger items this request deliberately removes. A probe-able item matches when its feature's
 * own request pattern fires inside the removal's object phrase; a label item when its whole label does.
 */
export function requestedRemovals(request: string, spec: AppSpec): SpecItem[] {
  const objects = removalObjects(request);
  if (objects.length === 0) return [];
  const hitFeatures = removedProbeFeatures(request);
  const lowerObjects = objects.map((o) => o.toLowerCase());
  return spec.items.filter((i) => {
    if (i.status === 'dropped') return false;
    if (i.probeable === false) return lowerObjects.some((o) => o.includes(i.label.toLowerCase()));
    return hitFeatures.has(i.feature);
  });
}
