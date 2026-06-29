import { GenerationTask } from './PlannerTypes';
import { Patch } from './IGenerationEngine';
import { EngineRegistry, EngineType } from './EngineRegistry';
import { runWithBreaker } from '../BuildStepBreaker';

/** Notified when an engine's circuit breaker trips open (P-BRE.9). */
export type CircuitOpenListener = (info: { step: string; openUntil: number }) => void;

export class EngineDispatcher {
    // `onCircuitOpen` is optional + defaults undefined so existing callers are unaffected.
    constructor(private registry: EngineRegistry, private onCircuitOpen?: CircuitOpenListener) {}

    async dispatch(task: GenerationTask): Promise<Patch[]> {
        const engineType = task.engine as EngineType;
        if (!this.registry.has(engineType)) {
            throw new Error(`Engine not registered for type: ${engineType}`);
        }

        const engine = this.registry.get(engineType);
        // P-BRE.9 — run each engine under a per-engine circuit breaker: a repeatedly-failing
        // engine fast-fails for a cooldown instead of dragging every build to the full timeout.
        return runWithBreaker(`engine:${engineType}`, () => engine.execute(task), this.onCircuitOpen);
    }
}
