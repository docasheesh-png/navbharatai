import { ProjectBlueprint } from '../ProjectBlueprint';

export class BlueprintValidator {
    validate(blueprint: ProjectBlueprint): void {
        const modules = blueprint.modules;
        
        // 1. Duplicate check (implied by Record key)

        // 2. Dependency validation
        for (const [name, mod] of Object.entries(modules)) {
            // Rule 5: Reject Authentication -> Backend
            if (name === 'Authentication' && mod.dependencies.includes('Backend')) {
                throw new Error(`Authentication cannot depend on Backend`);
            }

            const sanitizedDependencies = mod.dependencies.filter(dep => {
                if (dep === 'Frontend') {
                    console.warn(`Warning: Removing invalid dependency 'Frontend' from module '${name}'`);
                    return false;
                }
                return true;
            });
            mod.dependencies = sanitizedDependencies;

            for (const dep of mod.dependencies) {
                if (!modules[dep]) {
                    throw new Error(`Missing dependency: ${dep} for module ${name}`);
                }
            }
        }

        // 3. Cycle detection (DFS)
        const visited = new Set<string>();
        const recStack = new Set<string>();

        const hasCycle = (node: string): boolean => {
            visited.add(node);
            recStack.add(node);
            
            for (const dep of modules[node].dependencies) {
                if (!visited.has(dep)) {
                    if (hasCycle(dep)) return true;
                } else if (recStack.has(dep)) {
                    return true;
                }
            }
            
            recStack.delete(node);
            return false;
        };

        for (const modName of Object.keys(modules)) {
            if (!visited.has(modName)) {
                if (hasCycle(modName)) throw new Error(`Cycle detected involving: ${modName}`);
            }
        }
    }
}
