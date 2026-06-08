import { ProjectBlueprint } from '../ProjectBlueprint';
import { TechnologyArchitectureBlueprint } from './PatternTypes';
import { PatternMatcher } from './PatternMatcher';
import { ArchitectureSelector } from './ArchitectureSelector';

export class PatternResolutionEngine {
    private matcher = new PatternMatcher();
    private selector = new ArchitectureSelector();

    resolve(blueprint: ProjectBlueprint): TechnologyArchitectureBlueprint {
        const patterns = this.matcher.match(blueprint);
        if (patterns.length === 0) throw new Error('No architectural pattern found');
        return this.selector.select(blueprint, patterns);
    }
}
