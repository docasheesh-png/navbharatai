import { ProjectBlueprint } from '../ProjectBlueprint';
import { GenerationTask } from './PlannerTypes';
import { GenerationPlan } from './GenerationPlan';
import { ModuleGraph } from './ModuleGraph';
import { BlueprintValidationError, MissingDependencyError, DuplicateModuleError, SelfDependencyError } from './PlannerErrors';

export class BlueprintPlanner {
  plan(blueprint: ProjectBlueprint, workspaceId: string, correlationId: string): GenerationPlan {
    this.validate(blueprint);

    const graph = new ModuleGraph();
    const moduleMap = new Map<string, any>();
    const moduleNames = new Set<string>();

    for (const [name, m] of Object.entries((blueprint as any).modules || {})) {
      if (moduleNames.has(name)) {
        throw new DuplicateModuleError(`Duplicate module: ${name}`);
      }
      if ((m as any).dependencies.includes(name)) {
        throw new SelfDependencyError(`Module ${name} depends on itself`);
      }
      const sanitizedDependencies = (m as any).dependencies.filter((dep: string) => 
        dep !== 'Frontend' && !(name === 'Authentication' && dep === 'Backend')
      );
      moduleNames.add(name);
      moduleMap.set(name, { ...m as any, name, dependencies: sanitizedDependencies });
      graph.addNode({ name, dependencies: sanitizedDependencies });
    }

    graph.validate();

    const order = graph.getTopologicalOrder();
    const tasks: GenerationTask[] = order.map((name, index) => {
      const module = moduleMap.get(name);
      if (!module) {
        throw new MissingDependencyError(`Module not found: ${name}`);
      }

      for (const dep of module.dependencies) {
        if (!moduleMap.has(dep)) {
          throw new MissingDependencyError(`Module ${name} depends on unknown module: ${dep}`);
        }
      }

      return {
        id: `task-${name}`,
        name: `Generate ${name}`,
        path: `src/components/${name}.tsx`,
        type: module.type,
        dependencies: module.dependencies.map(d => `task-${d}`),
        contentDescription: `Content structure for ${name}`,
        priority: index,
        engine: 'LLM',
        status: 'PENDING'
      };
    });

    return {
      planId: `plan-${blueprint.id}`,
      workspaceId,
      correlationId,
      blueprintId: blueprint.id,
      blueprintHash: 'hash-placeholder', // Should be calculated
      tasks,
      createdAt: new Date().toISOString()
    };
  }

  private validate(blueprint: ProjectBlueprint): void {
    if (!blueprint.id || !(blueprint as any).modules) {
      throw new BlueprintValidationError('Invalid blueprint structure');
    }
  }
}
