
export function auditEnv() {
  const vars = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'VITE_GEMINI_API_KEY'];
  for (const v of vars) {
    const val = process.env[v];
    console.log(`[AUDIT] ${v} Exists: ${!!val}, Length: ${val?.length}, Prefix: ${val?.substring(0, 4)}, Suffix: ${val?.substring(val.length - 4)}`);
  }
}
