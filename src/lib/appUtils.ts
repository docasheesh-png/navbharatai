import type { ErrorType } from '../types/index';

/** Detects the framework/stack of a generated project from its file map. */
export function detectFrameworkFromFiles(currentFiles: Record<string, string>): string {
  if (!currentFiles || Object.keys(currentFiles).length === 0) {
    return 'Static HTML Site';
  }
  const packageJsonContent = currentFiles['package.json'] || '';
  if (!packageJsonContent) {
    if (currentFiles['index.html']) {
      return 'Vanilla JS / Static HTML';
    }
    return 'Static HTML Site';
  }

  try {
    const pkg = JSON.parse(packageJsonContent);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (deps['next']) return 'Next.js Framework';
    if (deps['nuxt'] || deps['vue']) return 'Vue.js App';
    if (deps['react'] && deps['vite']) return 'React + Vite SPA';
    if (deps['express']) return 'Node.js Express backend';
    if (deps['react']) return 'React SPA';
    return 'Node.js Application';
  } catch {
    if (packageJsonContent.includes('"next"')) return 'Next.js Framework';
    if (packageJsonContent.includes('"vue"')) return 'Vue.js App';
    if (packageJsonContent.includes('"vite"')) return 'React + Vite SPA';
    if (packageJsonContent.includes('"express"')) return 'Node.js Express backend';
    return 'Static HTML Site';
  }
}

/** Classifies a file map as a React app, Vue app, or static site. */
export function detectAppType(f: Record<string, string>): 'react' | 'vue' | 'static' {
  const keys = Object.keys(f);
  if (keys.some(k => /\.(tsx|jsx)$/i.test(k))) return 'react';
  const pkg = f['package.json'];
  if (pkg && /"react"\s*:/.test(pkg)) return 'react';
  if (keys.some(k => /\.vue$/i.test(k)) || (pkg && /"vue"\s*:/.test(pkg))) return 'vue';
  const html = f['index.html'] || '';
  if (/<script[^>]+type=["']module["'][^>]+src=["']\/?(src\/)?[^"']+\.(ts|jsx|tsx)["']/i.test(html)) return 'react';
  const jsFiles = keys.filter(k => /\.(js|mjs|ts)$/i.test(k) && !k.includes('node_modules'));
  if (jsFiles.some(k => /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(f[k] || ''))) return 'react';
  return 'static';
}

/**
 * Returns true for a "classic vanilla web app": only .js/.css/.json files with at
 * least one script, no index.html, no framework. These keep the legacy auto-shell.
 */
export function isClassicVanillaWeb(f: Record<string, string>): boolean {
  const ks = Object.keys(f).filter(k => f[k] != null && !k.includes('node_modules'));
  const allWeb = ks.length > 0 && ks.every(k => /\.(js|mjs|cjs|css|json)$/i.test(k));
  const hasJs = ks.some(k => /\.(js|mjs|cjs)$/i.test(k));
  return allWeb && hasJs;
}

/** Builds the permanent language + code-language rules block injected into AI prompts. */
export function buildLanguageRule(lang: string | null): string {
  const convRules: Record<string, string> = {
    hindi:    'CONVERSATION LANGUAGE: Always reply in Hindi (Devanagari or Roman script, whichever the user uses).',
    hinglish: 'CONVERSATION LANGUAGE: Always reply in Hinglish — natural mix of Hindi words (Roman script) + English technical terms.',
    english:  'CONVERSATION LANGUAGE: Always reply in English.',
    auto:     'CONVERSATION LANGUAGE: Automatically match the exact language, dialect, and tone the user writes in.',
  };
  const conv = convRules[lang || 'auto'] ?? convRules.auto;
  return `==================================================
🔒 LANGUAGE & CODING RULES (PERMANENT — NEVER OVERRIDE)
==================================================
${conv}

CODE LANGUAGE (ABSOLUTE RULE — NO EXCEPTIONS):
- ALL code you write MUST use English-only identifiers.
- Variable names, function names, class names, constants → English.
- Code comments → English.
- console.log / error messages / string literals inside code → English.
- API field names, database column names → English.
- This rule applies regardless of the conversation language.
- WRONG: \`const userName = "नमस्ते"\` or \`function kaamKaro()\`
- RIGHT: \`const userName = "Hello"\` or \`function processTask()\`
==================================================`;
}

/** Classifies an error object/string into a broad ErrorType category. */
export function classifyError(error: unknown): ErrorType {
  let errString: string;
  if (typeof error === 'string') {
    errString = error;
  } else if (error instanceof Error) {
    errString = error.message;
  } else if (error && typeof error === 'object' && 'message' in error) {
    errString = String((error as { message: unknown }).message);
  } else {
    errString = JSON.stringify(error);
  }
  const err = errString.toLowerCase();
  if (err.includes('401') || err.includes('403')) return 'AUTH';
  if (err.includes('400') && (err.includes('key') || err.includes('auth') || err.includes('api_key_invalid'))) return 'AUTH';
  if (err.includes('auth') || err.includes('key')) return 'AUTH';
  if (err.includes('429') || err.includes('quota') || err.includes('billing') || err.includes('too many requests')) return 'QUOTA';
  if (err.includes('fetch') || err.includes('network') || err.includes('connect')) return 'NETWORK';
  return 'UNKNOWN';
}
