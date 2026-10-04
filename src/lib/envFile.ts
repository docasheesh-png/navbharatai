// IS THIS A LIVE DOTENV FILE? — the one definition (security checklist, 2026-10-04).
//
// A live `.env` (`.env`, `.env.local`, `apps/web/.env.production`) holds real credentials; a committed
// template (`.env.example`, `.sample`, `.template`, `.dist`, `.tpl`) carries only placeholders. Read by
// the security scanner (SecurityAnalysis.isEnvSecretsFile) and by the phone-build assembler, which the
// APK screen imports — so it lives here, client-safe and dependency-free. PURE.

export function isLiveEnvFilePath(file: string): boolean {
  const base = (file || '').toLowerCase().split('/').pop() || '';
  if (!/^\.env(?:\.[a-z0-9_.-]+)?$/.test(base)) return false;          // .env, .env.local, .env.production, …
  return !/\.(?:example|sample|template|dist|tpl)$/.test(base);        // but NOT a committed .env.example template
}
