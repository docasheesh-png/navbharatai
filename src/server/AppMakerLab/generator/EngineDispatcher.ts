import { GenerationTask } from './PlannerTypes';
import { Patch } from './IGenerationEngine';
import { EngineRegistry, EngineType } from './EngineRegistry';

export class EngineDispatcher {
    constructor(private registry: EngineRegistry) {}

    async dispatch(task: GenerationTask): Promise<Patch[]> {
        const engineType = task.engine as EngineType;
        if (!this.registry.has(engineType)) {
            throw new Error(`Engine not registered for type: ${engineType}`);
        }
        
        const engine = this.registry.get(engineType);
        return engine.execute(task);
    }
}
