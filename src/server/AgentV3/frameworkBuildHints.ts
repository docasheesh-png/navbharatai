// AgentV3 — targeted repair hints for common Next.js build failures (sibling to prismaRepairHint).
//
// A `next build` / `npm run build` can fail with a framework-specific error whose fix the LLM keeps
// re-discovering by trial and error. Given the failed command's output, this returns ONE deterministic,
// actionable fix instruction that ToolDispatcher appends to the tool result so the builder converges in
// a single directed turn. GUIDANCE only — it never edits code. PURE + unit-tested. null when unrecognised.

interface HintRule {
  readonly id: string;
  readonly match: RegExp;
  readonly hint: string;
}

// Ordered most-specific → most-generic. FIRST match wins.
const NEXT_RULES: readonly HintRule[] = [
  {
    id: 'app-router-page-config-deprecated',
    match: /Page config in[^\n]*is deprecated\.?\s*Replace `?export const config/i,
    hint:
      'In the Next.js App Router, a route handler (`app/**/route.ts`) does NOT use ' +
      '`export const config = { api: { bodyParser: false } }` — that is Pages-router syntax and fails the ' +
      'build. Remove it. To read a RAW request body (e.g. verifying a Stripe webhook signature), call ' +
      '`const body = await req.text()` directly in the handler. If you need Node APIs or dynamic behaviour, ' +
      'use `export const runtime = "nodejs"` and/or `export const dynamic = "force-dynamic"` instead.',
  },
  {
    id: 'app-router-getServerSideProps',
    match: /getServerSideProps.*is not supported in the app directory|getStaticProps.*app directory/i,
    hint:
      'The Next.js App Router does not support `getServerSideProps`/`getStaticProps`. Fetch data directly ' +
      'inside an async Server Component (`export default async function Page() { const data = await … }`), ' +
      'or use a route handler under `app/api/**/route.ts`.',
  },
  {
    id: 'use-client-hooks',
    match: /You're importing a component that needs (useState|useEffect|useRef|use[A-Z]\w+)[^\n]*only works in a Client Component|add the "use client" directive/i,
    hint:
      'This component uses React hooks/browser APIs, so it must be a Client Component. Add `"use client";` ' +
      'as the VERY FIRST line of the file (above all imports).',
  },
];

/**
 * Return a single actionable fix instruction for a failed Next.js build command's output, or null when
 * the output is not a recognised Next.js build error. Only fires for output that is recognisably Next.js.
 * PURE.
 */
export function nextBuildRepairHint(output: string): string | null {
  const text = output || '';
  if (!/next|app router|app directory|\bapp\/|route\.[tj]sx?|use client|Client Component|Server Component/i.test(text)) return null;
  for (const rule of NEXT_RULES) {
    if (rule.match.test(text)) return rule.hint;
  }
  return null;
}
