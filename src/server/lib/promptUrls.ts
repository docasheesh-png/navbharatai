/**
 * A LINK IS NOT WORDS (autopsy a9f8d186, 2026-09-30).
 *
 * The prompt was a "circle to search" app with a reference link —
 * `https://play.google.com/store/apps/details?id=com.circletosearch.android`. The domain classifier
 * read `store` out of the URL and filed the app as ECOMMERCE, so the builder was told a production shop
 * "almost always needs" payments, a cart, orders, inventory and "accounts & addresses" — and it built an
 * Account screen nobody asked for. The same prompt with the link removed is `general`.
 *
 * A URL names a place, not a feature. Every keyword reader of a prompt (the domain classifier, the task
 * classifier) reads the text with its links removed. The link itself is untouched everywhere else — the
 * builder still sees it, and the reference-app reader still fetches it.
 *
 * Pure.
 */

// A scheme URL, a bare `www.` host, or a host-with-path such as `play.google.com/store/apps`.
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b(?:[a-z0-9-]+\.)+(?:com|in|org|net|io|app|dev|co|ai|xyz|me|info|gov|edu)\/\S*/gi;

export function withoutUrls(text: string): string {
  return String(text ?? '').replace(URL_RE, ' ');
}
