/**
 * 🔴 A CLIENT BUILT FROM A KEY NOBODY SAVED IS A WHITE SCREEN (failedbr #2271, 2026-11-20 — "INDIAN MUSIC").
 *
 * The build asked for VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, nobody answered, and the builder wrote
 * `src/lib/supabase.ts` as `export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, …)`. With no key
 * saved, supabase-js throws "supabaseUrl is required" while the module loads, so the whole app is a blank page
 * (PREVIEW_NOT_RENDERED) and an unfinished-resume had to spend a turn on it. NO_FAKE_FEATURE_RULE already says a
 * missing key shows an honest red notice; the platform's own guarded client (`generate_db_config`, DbConfigGenerator)
 * already does exactly that — the hand-written one did neither.
 *
 * This reads the SHAPE at write time — a module-scope `= createClient(` fed from a Supabase env key, with no
 * configured-check around it — and says so once per build while the file is open. A note, never a rewrite: the
 * guarded forms (`cond ? createClient(…) : …`, an `if`, a function that builds it on demand) are left alone. PURE.
 */

const ENV_KEY = /\b(?:import\.meta\.env|process\.env)\.(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)?SUPABASE_(?:URL|ANON_KEY|KEY)\b/;
const IMPORTS_SUPABASE = /from\s+['"]@supabase\/supabase-js['"]/;
/** `const x = createClient(` / `export const x: T = createClient(` / `export default createClient(` at column 0. */
const MODULE_SCOPE_CALL = /^(?:export\s+)?(?:(?:const|let|var)\s+\w+\s*(?::\s*[\w.<>\s,]+)?\s*=\s*|default\s+)createClient\s*\(/m;

export function unguardedEnvClient(path: string, content: string | null | undefined): boolean {
  const text = String(content ?? '');
  if (!/\.(?:[cm]?[jt]sx?)$/.test(String(path ?? ''))) return false;
  return IMPORTS_SUPABASE.test(text) && ENV_KEY.test(text) && MODULE_SCOPE_CALL.test(text);
}

export function unguardedEnvClientNote(path: string): string {
  return `\n\n⚠️ ${path} builds the Supabase client as the module loads, straight from its env keys. While those keys are not `
    + 'saved, supabase-js throws "supabaseUrl is required" and the WHOLE app is a white screen. Build the client only when '
    + 'both keys are set (export a `supabaseConfigured` flag and show the honest red "add your keys" notice where data is '
    + 'needed), or call generate_db_config with provider "supabase", which writes exactly that guarded client.';
}
