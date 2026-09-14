/**
 * The Express 4 → 5 seams, in one place.
 *
 * Express 5 is not a drop-in upgrade for this codebase. Three of its changes reach real routes, and
 * two of them are INVISIBLE to TypeScript — which is exactly why they live here, named, rather than
 * as casts sprinkled across seventeen files.
 */

/**
 * A wildcard route's captured path, as a string.
 *
 * 🔴 EXPRESS 5 BREAKS BOTH HALVES OF THE OLD SPELLING. A bare `'*'` (or a trailing `'/foo/*'`) is no
 * longer a valid path at all — path-to-regexp v8 THROWS when the route is registered, so the server
 * does not start. The replacement names the capture, `'/foo/*splat'`, and the value arrives as an
 * **array of path segments**, where Express 4 gave a single joined string in `req.params[0]`.
 *
 * Both of this repo's proxies (the ESM mirror and the live-preview forwarder) build an upstream URL
 * out of that value, so getting it wrong does not throw — it quietly fetches the WRONG THING. This
 * helper is the one place that conversion happens.
 *
 * Accepts the array (Express 5), a plain string (a route that used a named param), and the legacy
 * numbered key, so it is correct whichever spelling a route uses. PURE.
 */
export function splatPath(params: Record<string, unknown> | undefined | null): string {
  if (!params) return '';
  const raw = (params as Record<string, unknown>).splat ?? (params as Record<string, unknown>)[0];
  if (Array.isArray(raw)) return raw.map((s) => String(s)).join('/');
  return raw == null ? '' : String(raw);
}

/**
 * One route parameter, as the string the route actually receives.
 *
 * ⚠️ WHY A CAST IS HONEST HERE, AND ONLY HERE. Express 5's `ParamsDictionary` is typed
 * `string | string[]` because a WILDCARD capture can be an array. This repo has exactly three
 * wildcard routes, and all three read their capture through `splatPath` above — so for every other
 * route, every parameter is a plain string at runtime, and `string | string[]` is a widening that
 * describes a case those routes cannot reach.
 *
 * Using this instead of 80 inline `as string` casts keeps that reasoning in ONE place with the
 * evidence attached, so a later reader can check whether it still holds (count the wildcard routes)
 * rather than finding a bare cast and having to guess why it was safe.
 */
export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('/');
  return value ?? '';
}

/**
 * Restore Express 4's `req.body` default.
 *
 * 🔴 THE HAZARD THIS REMOVES, AND WHY NOTHING ELSE COULD CATCH IT. In Express 4, `req.body` was `{}`
 * whenever a body parser ran but found nothing to parse. In Express 5 it is left **`undefined`**. This
 * repo reads `req.body` in **419 places** — `const { x } = req.body`, `req.body.x` — across auth,
 * wallet, secrets and webhook routes.
 *
 * `req.body` is typed `any`, so **not one of those 419 sites produces a type error**: `npm run
 * typecheck` passes and every one of them still throws `Cannot read properties of undefined` the first
 * time a request arrives whose Content-Type the parser did not match. A GET with no body, a POST whose
 * client omitted the header, a webhook delivered as `text/plain` — all of them used to get `{}`.
 *
 * A green CI would therefore have proved nothing about this class. Restoring the Express 4 default at
 * the ONE point every request passes through makes all 419 sites behave exactly as they did, instead
 * of asking a reviewer to find them.
 *
 * ⚠️ Register it AFTER the body parsers — it must fill in only what they left unset, never replace a
 * parsed body.
 */
export function normalizeMissingBody(req: { body?: unknown }, _res: unknown, next: () => void): void {
  if (req.body === undefined) req.body = {};
  next();
}

/**
 * A route's parameters, as the strings the route actually receives.
 *
 * The plural of `routeParam`, for the common `const { userId } = routeParams(req.params)` shape — the
 * majority of this repo's parameter reads, and the right place to normalise, because fixing the
 * DESTRUCTURE fixes every use of the variable that follows it. Same reasoning, same evidence: the
 * three wildcard routes read their capture through `splatPath`, so nothing reaching here is an array.
 */
export function routeParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = routeParam(v);
  return out;
}
