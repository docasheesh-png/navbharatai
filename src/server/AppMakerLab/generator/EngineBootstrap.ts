import { EngineRegistry, EngineType } from './EngineRegistry';
import { LLMGenerationEngine } from './LLMGenerationEngine';
import { EngineDispatcher } from './EngineDispatcher';

export function bootstrapEngines(registry: EngineRegistry) {
    registry.register(EngineType.LLM, new LLMGenerationEngine());
}

export function createConfiguredDispatcher(): EngineDispatcher {
    const registry = new EngineRegistry();
    bootstrapEngines(registry);
    return new EngineDispatcher(registry);
}
