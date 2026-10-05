// Boot-time presence check for the Gemini key names, so a missing key is visible in the log.
//
// 🔒 PRESENCE AND LENGTH ONLY (forensic audit 2026-10-04). This used to print the first four AND last
// four characters of every one of these keys on every boot — eight characters of a live secret in a log
// that every operator with log access can read. A length says "a key is set and it is the right shape";
// nothing more is needed to diagnose a missing or truncated key.
export function auditEnv() {
  const vars = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'VITE_GEMINI_API_KEY'];
  for (const v of vars) {
    const val = process.env[v];
    console.log(`[AUDIT] ${v} Exists: ${!!val}, Length: ${val ? val.length : 0}`);
  }
}
