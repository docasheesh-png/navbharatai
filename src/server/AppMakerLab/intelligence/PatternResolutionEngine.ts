import { ProjectBlueprint } from '../ProjectBlueprint';
import { TechnologyArchitectureBlueprint } from './PatternTypes';
import { PatternMatcher } from './PatternMatcher';
import { ArchitectureSelector } from './ArchitectureSelector';
import { generateADR, type ADRFile } from './ADRManager';

export class PatternResolutionEngine {
    private matcher = new PatternMatcher();
    private selector = new ArchitectureSelector();

    resolve(blueprint: ProjectBlueprint): TechnologyArchitectureBlueprint {
        const patterns = this.matcher.match(blueprint);
        if (patterns.length === 0) throw new Error('No architectural pattern found');
        return this.selector.select(blueprint, patterns);
    }

    /**
     * P-PME.10 — resolve the architecture AND auto-capture the decision as an ADR markdown file
     * (`docs/decisions/ADR-NNN.md`) the caller can write into the generated workspace. Additive:
     * the original `resolve()` is unchanged, so existing callers are unaffected.
     */
    resolveWithADR(blueprint: ProjectBlueprint, opts: { number?: number; date?: string } = {}): { architecture: TechnologyArchitectureBlueprint; adr: ADRFile } {
        const patterns = this.matcher.match(blueprint);
        if (patterns.length === 0) throw new Error('No architectural pattern found');
        const architecture = this.selector.select(blueprint, patterns);
        const adr = generateADR({
            number: opts.number ?? 1,
            date: opts.date ?? new Date().toISOString().slice(0, 10),
            ranked: patterns.map((p) => ({ pattern: p.pattern, score: p.score, matchedConstraints: p.matchedConstraints, rejectedConstraints: p.rejectedConstraints })),
        });
        return { architecture, adr };
    }
}
