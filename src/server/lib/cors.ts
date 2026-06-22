const ALLOWED_ORIGINS = new Set([
  'https://navbharatai.web.app',
  'https://navbharatai.firebaseapp.com',
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
]);

export function setCorsHeaders(
  req: { headers: { origin?: string } },
  res: { setHeader: (name: string, value: string) => void },
): void {
  const origin = req.headers.origin;
  if (!origin) return;
  // Reflect only allow-listed origins. In non-production we additionally permit localhost
  // for local dev — but NEVER reflect an arbitrary attacker origin, even outside production
  // (the old `NODE_ENV !== 'production'` blanket reflection was a CORS hole if NODE_ENV was unset).
  const isLocalDev = process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (ALLOWED_ORIGINS.has(origin) || isLocalDev) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}
