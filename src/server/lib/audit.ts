/**
 * Lightweight structured audit logger. Extracted from the server.ts monolith
 * (Phase 1) so route modules can share it without closing over server scope.
 */
export function audit(event: string, meta: Record<string, any> = {}): void {
  const entry = { ts: new Date().toISOString(), event, ...meta };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}
