/** Exact browser origins only; server-side MCP clients normally send no Origin. */
export function failedReportOriginOk(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = ['https://navbharatai.com', 'https://www.navbharatai.com', 'https://chatgpt.com', 'https://chat.openai.com', 'https://claude.ai', 'https://grok.com'];
  // Additional compatible clients can be configured without changing the public resource URL.
  for (const raw of (process.env.FAILED_REPORT_MCP_ORIGINS ?? '').split(',')) {
    const value = raw.trim();
    try { const u = new URL(value); if (u.protocol === 'https:' && u.origin === value) allowed.push(value); } catch { /* ignore malformed configuration */ }
  }
  return allowed.includes(origin);
}
