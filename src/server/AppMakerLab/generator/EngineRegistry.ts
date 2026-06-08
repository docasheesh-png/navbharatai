import { IGenerationEngine } from './IGenerationEngine';

export enum EngineType {
    DEFAULT = 'DEFAULT',
    FRONTEND = 'FRONTEND',
    BACKEND = 'BACKEND',
    DATABASE = 'DATABASE',
    LLM = 'LLM'
}

export class EngineRegistry {
    private engines: Map<EngineType, IGenerationEngine> = new Map();

    register(type: EngineType, engine: IGenerationEngine): void {
        this.engines.set(type, engine);
    }

    get(type: EngineType): IGenerationEngine {
        const engine = this.engines.get(type);
        if (!engine) {
            throw new Error(`Engine not registered for type: ${type}`);
        }
        return engine;
    }

    has(type: EngineType): boolean {
        return this.engines.has(type);
    }
}
