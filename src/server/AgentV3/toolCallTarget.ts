// AgentV3 — what a tool call was actually AIMED at, for the build report.
//
// ⚠️ THE BLIND SPOT THIS CLOSES (measured 2026-08-25, from the admin's own reports while answering
// "weak providers par bhi complex app bana sake").
//
// Two real builds, by tool:
//     report_b   38 read_file · 12 grep   →  50 of 78 calls (64%) are READING
//     report2    42 read_file · 26 grep   →  68 of 95 calls (72%) are READING
//
// Two thirds to three quarters of a weak build's entire turn budget goes on LOOKING at code, not
// writing it — and it gets worse on a complex app, because there is more to look at. That is the
// biggest single lever there is for the weak tier.
//
// And the report records `▶ read_file` with no target. So the one question that would tell us whether
// those turns are WASTE — is it reading the same file over and over? — cannot be asked of any build we
// have ever run. Making it visible is not a substitute for the fix; it is the only honest way to earn
// one, instead of guessing at a cache nobody has evidence for.
//
// 🔒 SECRETS CANNOT LEAK THROUGH THIS, BY CONSTRUCTION. It reads a fixed list of structured fields
// (path, pattern, url…) and never the free-form ones. A `bash` command keeps only its FIRST TOKEN —
// the program name — because the rest of a shell line is exactly where a token or a password lives.
// That is a whitelist, not a filter: there is no input shape that can carry a credential into the
// output, so this needs no redactor and cannot drift out of step with one.
//
// PURE — no I/O.

/** Fields that are a target, and are safe to show whole. */
const TARGET_FIELDS = ['path', 'file', 'filePath', 'pattern', 'query', 'url', 'symbol', 'name'] as const;

/** Fields whose value is a free-form command line — only the program name is kept. */
const COMMAND_FIELDS = ['command', 'cmd', 'script'] as const;

/** Long enough to identify a file in a real project, short enough for a timeline entry. */
const MAX = 80;

const clip = (s: string): string => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

/**
 * A short, safe label for what this call was aimed at — or '' when there is nothing worth showing.
 *
 * Returns the FIRST matching field rather than joining several: a timeline entry is scanned, not read,
 * and two targets on one line is worse than one.
 */
export function toolCallTarget(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const o = input as Record<string, unknown>;

  for (const key of TARGET_FIELDS) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return clip(v.trim());
  }

  for (const key of COMMAND_FIELDS) {
    const v = o[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    // FIRST TOKEN ONLY. `npm run build` → `npm`. An env assignment prefix is skipped so the label is
    // the program rather than `FOO=bar`, and a bare assignment yields nothing at all — never the value.
    const first = v.trim().split(/\s+/).find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ?? '';
    if (first) return clip(first);
  }

  // A port is a number and is genuinely useful on update_preview.
  const port = o.port;
  if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) return `:${port}`;

  return '';
}

/** The `detail` line for a TOOL_CALL entry: the agent, and what it aimed at. PURE. */
export function toolCallDetail(agent: unknown, input: unknown): string | undefined {
  const parts: string[] = [];
  if (agent) parts.push(`agent=${String(agent)}`);
  const target = toolCallTarget(input);
  if (target) parts.push(target);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
