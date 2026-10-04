// FILES IN dist/ THAT ARE NOT FOR THE PUBLIC (crash-reporting audit, 2026-10-04).
//
// `npm run build` writes the SERVER bundle (`dist/server.cjs`) and its source map (`dist/server.cjs.map`,
// about 27 MB of our original server source) into the same `dist/` folder the website is served from,
// and `express.static(dist)` served everything in it. So the whole server's source was one GET away.
// Nothing else in production needs either file over HTTP, and no source map is ever meant to be
// public: a map is for symbolicating an error on OUR side, never something a visitor downloads.
//
// PURE. Mounted in front of the static handlers in server.ts.

/** True for a request path that must never be served from dist/. */
export function isPrivateBuildFile(path: string): boolean {
  const p = (path || '').toLowerCase().split('?')[0];
  return /^\/server\.c?js$/.test(p) || /\.map$/.test(p);
}
