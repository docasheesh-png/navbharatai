import { ProjectMemory } from './ProjectGraph';
import { analyzeWithAST } from '../AgentV3/ASTAnalyzer';

export class MemoryIndexer {
  /**
   * Regex baseline — captures the FIRST exported symbol per file. Kept as the synchronous
   * fallback used by `indexWithAST` when the AST analyzer is unavailable / fails, and for
   * back-compat with existing callers. Behaviour unchanged.
   */
  static index(filePath: string, content: string, memory: ProjectMemory): ProjectMemory {
    // Very simple extraction logic
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        if (content.includes('export default function') || content.includes('export const')) {
            const match = content.match(/export (?:default )?(?:const|function|class) (\w+)/);
            if (match && match[1]) {
                const componentName = match[1];
                if (!memory.components.includes(componentName)) {
                    memory.components.push(componentName);
                }
            }
        }
    }
    if (!memory.files.includes(filePath)) {
        memory.files.push(filePath);
    }
    return memory;
  }

  /**
   * P4.3 — AST-backed indexing (consolidation). Runs the regex baseline FIRST (so it can
   * never regress — its result is always included), then ENRICHES via the real ts-morph
   * AST analyzer: it adds EVERY exported symbol/component name (not just the first) and the
   * detected route paths. If the AST analyzer is unavailable or parsing fails it returns
   * null and we keep exactly the regex baseline. Never throws.
   */
  static async indexWithAST(filePath: string, content: string, memory: ProjectMemory): Promise<ProjectMemory> {
    // 1) Regex baseline — guarantees no regression vs. the old behaviour.
    this.index(filePath, content, memory);

    // 2) AST enrichment (graceful: null on unsupported file / parse failure / ts-morph missing).
    try {
      const facts = await analyzeWithAST(filePath, content);
      if (facts) {
        const names = [
          ...facts.components,
          // All exported top-level names (matches the loose "components" set the regex fed),
          // excluding the synthetic 'default' key ts-morph uses for default exports.
          ...facts.symbols.map((s) => s.name).filter((n) => n && n !== 'default'),
        ];
        for (const name of names) {
          if (!memory.components.includes(name)) memory.components.push(name);
        }
        for (const route of facts.routes) {
          if (!memory.routes.includes(route)) memory.routes.push(route);
        }
      }
    } catch {
      // Enrichment is best-effort — the regex baseline already populated memory.
    }
    return memory;
  }
}
