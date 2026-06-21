/**
 * Phase 5.4 — Error pattern learning: pure, zero-I/O pattern matcher.
 *
 * Maintains a curated list of common build/runtime failures and the specific
 * fix hints to inject into the agent's next prompt. Hard-coded patterns give
 * immediate value; the `ErrorPatternStore` adds learned patterns over time.
 *
 * Two entry points:
 *  - `matchErrorPatterns(errorText)` — match against validation/syntax failure text.
 *  - `hintForInstruction(instruction)` — pre-build hints based on task keywords.
 *
 * Both return an array of short, actionable hint strings. Empty array = no match.
 * Never throws.
 */

interface ErrorPattern {
  regex: RegExp;
  hint: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    regex: /Cannot find module ['"]([^'"]+)['"]/i,
    hint: "If 'Cannot find module' errors appear: verify the package is in package.json dependencies (npm packages use their exact name) and local file imports use relative paths (e.g. './utils' not 'utils').",
  },
  {
    regex: /ERESOLVE.*peer dep|peer.*ERESOLVE|npm.*ERESOLVE/i,
    hint: 'Peer dependency conflict: use --legacy-peer-deps flag in any npm install commands (e.g. `npm install --legacy-peer-deps`) to bypass strict peer checks.',
  },
  {
    regex: /is not exported from|has no exported member/i,
    hint: "Named import error: verify the exact export name in the source module. Use 'import { ExactName } from' for named exports, or 'import DefaultName from' for default exports.",
  },
  {
    regex: /Expected corresponding JSX closing tag|JSX element.*no.*closing tag|Unterminated JSX/i,
    hint: 'Unclosed JSX: every opening tag needs a matching closing tag or must be self-closing with />. Check for typos in tag names and mismatched nesting.',
  },
  {
    regex: /Module not found.*can't resolve|Can't resolve '([^']+)'/i,
    hint: "Vite/webpack module resolution error: ensure the imported file exists at the path, the file extension matches (use .tsx for JSX), and aliases are configured in vite.config.ts.",
  },
  {
    regex: /React is not defined|_react\.default is not defined/i,
    hint: "With Vite + React 17+ the JSX transform is automatic — no need to import React at the top of every file. If using React hooks or components, import just what you need: 'import { useState } from \"react\"'.",
  },
  {
    regex: /tailwindcss.*not found|Cannot find.*tailwind|@tailwindcss\/vite/i,
    hint: "Tailwind CSS v4 with Vite: install 'tailwindcss @tailwindcss/vite' and add '@tailwindcss/vite' to the vite.config.ts plugins array. No tailwind.config.ts needed for v4.",
  },
  {
    regex: /SyntaxError.*Unexpected token|SyntaxError.*Invalid or unexpected token/i,
    hint: 'Syntax error in JavaScript/TypeScript: look for missing commas, unclosed brackets/braces/parentheses, or invalid characters. Check the line number in the error and its surroundings.',
  },
  {
    regex: /React Hook.*cannot be called.*conditionally|Rules of Hooks/i,
    hint: "React Hooks must always be called at the top level of a component, never inside conditions, loops, or nested functions. Move the hook call to the top of the component function.",
  },
  {
    regex: /Type '.*' is not assignable to type|typescript.*type.*error/i,
    hint: "TypeScript type mismatch: check that the value's type matches the declared type. For intentional overrides use 'as Type'. Check for optional fields (?:) that may be undefined when accessed.",
  },
  {
    regex: /Cannot read propert(?:y|ies) of (null|undefined)|TypeError.*undefined.*property/i,
    hint: "Null/undefined error: add optional chaining (?.) or null checks before accessing properties. For arrays: initialise to [] not undefined. For objects: check if the value is loaded before rendering.",
  },
  {
    regex: /failed to compile|compilation failed/i,
    hint: 'Compilation failed: fix all TypeScript errors first (run with strict: false temporarily if needed), then restore strict mode. Start with the first error — later errors are often cascades of the first.',
  },
  {
    regex: /vite.*config.*not.*found|no vite.*config/i,
    hint: "Create a vite.config.ts in the project root: import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; export default defineConfig({ plugins: [react()] });",
  },
  {
    regex: /supabase.*client.*not.*initialized|supabase.*url|supabase.*anon/i,
    hint: "Supabase client needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables. Create a .env file and access them via import.meta.env.VITE_SUPABASE_URL in your code.",
  },
];

/** Pre-build hints based on common keywords in the task instruction. */
interface InstructionHint {
  keywords: RegExp;
  hint: string;
}

const INSTRUCTION_HINTS: InstructionHint[] = [
  {
    keywords: /tailwind|tailwindcss/i,
    hint: "Tailwind CSS v4: install 'tailwindcss @tailwindcss/vite', import 'tailwindcss' as a vite plugin, and add '@import \"tailwindcss\"' in the main CSS file instead of the old @tailwind directives.",
  },
  {
    keywords: /supabase|auth.*supabase|supabase.*auth/i,
    hint: "Supabase: use createClient from '@supabase/supabase-js'. Always read keys from import.meta.env.VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — never hardcode them.",
  },
  {
    keywords: /firebase|firestore|firebase.*auth/i,
    hint: "Firebase: import functions from modular SDK ('firebase/app', 'firebase/firestore'). Use initializeApp once in a shared config file. Always check if the user brought their own Firebase config via env vars.",
  },
  {
    keywords: /react.router|react-router|routing/i,
    hint: "React Router v6: use createBrowserRouter + RouterProvider (the recommended Data Router pattern), or BrowserRouter + <Routes><Route> for simpler apps. Use useNavigate() for programmatic navigation.",
  },
  {
    keywords: /zustand|state.*management/i,
    hint: "Zustand store: define with create<State>()((set) => ({ ... })). Use the store hook directly in components. For async actions use set() after the await. Avoid mixing zustand with useState for shared state.",
  },
  {
    keywords: /chart|recharts|graph|visualization/i,
    hint: "Recharts: wrap charts in a ResponsiveContainer with width='100%' and a fixed height. Import only the chart type you need (BarChart, LineChart, etc.) to keep bundle size small.",
  },
  {
    keywords: /animation|framer.motion|animate/i,
    hint: "Framer Motion v11+: import motion from 'framer-motion'. Use <motion.div> for animated elements, AnimatePresence for exit animations. Keep animations subtle — users with prefers-reduced-motion should see simpler versions.",
  },
];

/**
 * Match known error patterns in build/validation/syntax failure text.
 * Returns an array of actionable hint strings (may be empty).
 */
export function matchErrorPatterns(errorText: string): string[] {
  if (!errorText) return [];
  const hints: string[] = [];
  for (const { regex, hint } of ERROR_PATTERNS) {
    if (regex.test(errorText) && !hints.includes(hint)) hints.push(hint);
  }
  return hints;
}

/**
 * Return pre-build hints based on technology keywords in the task instruction.
 * Injected into the agent's system prompt BEFORE coding starts, so the agent
 * avoids known pitfalls from the start rather than discovering them after failure.
 */
export function hintForInstruction(instruction: string): string[] {
  if (!instruction) return [];
  const hints: string[] = [];
  for (const { keywords, hint } of INSTRUCTION_HINTS) {
    if (keywords.test(instruction) && !hints.includes(hint)) hints.push(hint);
  }
  return hints;
}
