// Shared reverse-DNS application-id helpers for the export generators (mobile Capacitor, desktop Electron).
//
// Both Capacitor and Electron identify an app by a reverse-DNS id (e.g. com.acme.myshop). Centralized here
// (rule 4 — one shared, tested implementation) so the mobile and desktop generators can never drift on what
// a valid id is or how one is derived from an app name. Pure; deterministic.

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

// A reverse-DNS app id becomes a Java PACKAGE (com.acme.shop → package com.acme.shop), and Android's
// manifest merger / R.java generation REJECTS a package whose segment is a Java reserved word or literal
// (autopsy 2026-08-11, G8): an app named "New Store" derives `com.navbharat.new`, and `com.new.shop` is a
// syntactically-valid reverse-DNS id — both pass the old regex, then `cap add android` / AGP fails with
// "<segment> is not a valid Java package name". So a valid id also forbids these as segments. Fixed in the
// SHARED helper (rule 3) so the mobile AND desktop generators are both corrected at once.
const JAVA_RESERVED = new Set<string>([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while',
  // literals — also illegal as identifiers
  'true', 'false', 'null',
  // '_' is a reserved identifier on its own since Java 9
  '_',
]);

/** A dot-separated segment that Android/Java will accept in a package name (not a reserved word). */
function isSafeSegment(seg: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(seg) && !JAVA_RESERVED.has(seg);
}

/** Make one segment safe: a reserved word gets an `x` suffix (new → newx), keeping it readable. */
function safeSegment(seg: string): string {
  return JAVA_RESERVED.has(seg) ? `${seg}x` : seg;
}

/**
 * A valid application id: 2+ dot-separated segments, each starting with a letter then [a-z0-9_], and no
 * segment a Java reserved word/literal (which Android's package tooling rejects even though it is
 * syntactically well-formed).
 */
export function isValidAppId(id: string): boolean {
  const segs = String(id || '').split('.');
  return segs.length >= 2 && segs.every(isSafeSegment);
}

/** Derive a valid reverse-DNS app id from an app name — `com.navbharat.<slug>` (safe fallback when empty). */
export function deriveAppId(appName: string): string {
  let slug = clean(appName).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug || !/^[a-z]/.test(slug)) slug = `app${slug}`; // a segment must start with a letter
  slug = safeSegment(slug); // an app named "New"/"Class"/"Final" must not derive a reserved segment
  return `com.navbharat.${slug}`;
}

/**
 * Resolve the id to use: an explicit valid id wins; an explicit id that is well-formed reverse-DNS but
 * carries a reserved-word segment is REPAIRED in place (com.new.shop → com.newx.shop) so the user keeps
 * their chosen org prefix; anything else derives from the app name. Never returns invalid.
 */
export function resolveAppId(requestedAppId: string | undefined, appName: string): string {
  const requested = clean(requestedAppId).toLowerCase();
  if (isValidAppId(requested)) return requested;
  // Well-formed reverse-DNS shape (2+ letter-led segments) but blocked only by a reserved word → repair it
  // rather than throw the user's whole id away.
  const segs = requested.split('.');
  if (segs.length >= 2 && segs.every((s) => /^[a-z][a-z0-9_]*$/.test(s))) {
    const repaired = segs.map(safeSegment).join('.');
    if (isValidAppId(repaired)) return repaired;
  }
  return deriveAppId(appName);
}
