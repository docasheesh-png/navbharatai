/**
 * An SVG imported as a React component in two plugins' styles at once (Q-2766, BR2001).
 *
 * `import { ReactComponent as Start } from './start.svg?react'` mixes Create React App's svgr (a NAMED
 * `ReactComponent` export, no query) with vite-plugin-svgr v4 (the `?react` query, which gives a DEFAULT export
 * and nothing named). The pair never works in either: the preview logged errors until the builder installed and
 * rewired the plugin. The shape is exact, so it is said while the file is still open, with the one-line fix.
 * PURE.
 */

const MIXED_SVG_IMPORT = /import\s*\{([^}]*\bReactComponent\b[^}]*)\}\s*from\s*(['"])([^'"\n]+\.svg)\?react\2/g;

export interface MixedSvgImport { line: number; spec: string; local: string }

export function findMixedSvgImports(content: string): MixedSvgImport[] {
  if (typeof content !== 'string' || !content.includes('?react')) return [];
  const out: MixedSvgImport[] = [];
  for (const m of content.matchAll(MIXED_SVG_IMPORT)) {
    const alias = /\bReactComponent\s+as\s+([A-Za-z_$][\w$]*)/.exec(m[1]);
    out.push({ line: content.slice(0, m.index).split('\n').length, spec: m[3], local: alias ? alias[1] : 'Icon' });
  }
  return out;
}

/** The note the builder hears while the file is still open. '' when clean. PURE. */
export function mixedSvgImportWriteNote(file: string, content: string): string {
  const hits = findMixedSvgImports(content);
  if (!hits.length) return '';
  const lines = hits.slice(0, 4).map((h) => `  ${file}:${h.line} → import ${h.local} from '${h.spec}?react';`).join('\n');
  return `\n\n⛔ SVG IMPORT MIXES TWO PLUGINS — \`{ ReactComponent }\` is Create React App's export; \`?react\` is vite-plugin-svgr's, `
    + `which gives only a DEFAULT export. Use the default import:\n${lines}\n`;
}
