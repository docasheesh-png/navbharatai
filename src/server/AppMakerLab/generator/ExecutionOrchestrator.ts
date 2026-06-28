import { EventType } from '../eventbus/EventTypes';
import { IEvent } from '../eventbus/IEvent';
import { GenerationPlan } from './GenerationPlan';
import { GenerationTask } from './PlannerTypes';
import { TaskScheduler } from './TaskScheduler';
import { EngineDispatcher } from './EngineDispatcher';
import { PatchAggregator } from './PatchAggregator';
import { TaskStatus, ExecutionConfig } from './ExecutionTypes';
import { ICheckpointManager } from '../checkpoint/ICheckpointManager';
import { IEventBus } from '../eventbus/IEventBus';
import { Patch } from './IGenerationEngine';
import { log } from '../../logger';

export class ExecutionOrchestrator {
    private retryCounters: Map<string, number> = new Map();

    constructor(
        private eventBus: IEventBus,
        private dispatcher: EngineDispatcher,
        private checkpointManager: ICheckpointManager,
        private config: ExecutionConfig = { maxRetries: 3, baseBackoffMs: 1000 }
    ) {}

    private createEvent(plan: GenerationPlan, type: EventType, payload: Record<string, unknown>): IEvent {
        return {
            eventId: Math.random().toString(36).substring(7),
            correlationId: plan.correlationId,
            workspaceId: plan.workspaceId,
            sender: 'ExecutionOrchestrator',
            timestamp: new Date(),
            type,
            payload
        };
    }

    async execute(plan: GenerationPlan): Promise<Patch[]> {
        const scheduler = new TaskScheduler(plan.tasks);
        const aggregator = new PatchAggregator();

        await this.eventBus.publish(this.createEvent(plan, EventType.GENERATION_STARTED, { planId: plan.planId }));

        try {
            while (!scheduler.isComplete()) {
                const batch = scheduler.getNextBatch();
                const tasks = batch.map(task => this.executeTaskWithRetry(plan, task, scheduler, aggregator));

                await Promise.all(tasks);
            }
            await this.eventBus.publish(this.createEvent(plan, EventType.GENERATION_COMPLETED, { planId: plan.planId }));
        } catch (error) {
            await this.eventBus.publish(this.createEvent(plan, EventType.GENERATION_FAILED, { planId: plan.planId, error }));
            throw error;
        }

        return aggregator.getPatches();
    }

    async restoreFromCheckpoint(plan: GenerationPlan): Promise<{ scheduler: TaskScheduler, aggregator: PatchAggregator }> {
        const state = await this.checkpointManager.load(plan.planId);
        const scheduler = new TaskScheduler(plan.tasks);
        scheduler.restoreState(state.taskStatuses);
        const aggregator = new PatchAggregator();
        aggregator.addPatches(state.patches);
        
        await this.eventBus.publish(this.createEvent(plan, EventType.EXECUTION_RESTORED, { planId: plan.planId }));
        return { scheduler, aggregator };
    }

    async resumeExecution(plan: GenerationPlan, scheduler: TaskScheduler, aggregator: PatchAggregator): Promise<Patch[]> {
        await this.eventBus.publish(this.createEvent(plan, EventType.EXECUTION_RESUMED, { planId: plan.planId }));
        
        while (!scheduler.isComplete()) {
            const batch = scheduler.getNextBatch();
            const tasks = batch.map(task => this.executeTaskWithRetry(plan, task, scheduler, aggregator));
            await Promise.all(tasks);
        }
        
        await this.eventBus.publish(this.createEvent(plan, EventType.GENERATION_COMPLETED, { planId: plan.planId }));
        return aggregator.getPatches();
    }

    cancelExecution(plan: GenerationPlan, scheduler: TaskScheduler) {
        this.eventBus.publish(this.createEvent(plan, EventType.TASK_CANCELLED, { planId: plan.planId }));
    }

    private async executeTaskWithRetry(
        plan: GenerationPlan,
        task: GenerationTask, 
        scheduler: TaskScheduler, 
        aggregator: PatchAggregator,
    ): Promise<void> {
        if (!task.path) {
            scheduler.updateTaskStatus(task.id, TaskStatus.FAILED);
            const error = new Error(`GenerationTask missing path: ${task.name}`);
            await this.eventBus.publish(this.createEvent(plan, EventType.TASK_FAILED, { taskId: task.id, error: String(error) }));
            throw error;
        }
        
        let attempts = this.retryCounters.get(task.id) || 0;
        
        try {
            await this.eventBus.publish(this.createEvent(plan, EventType.TASK_STARTED, { taskId: task.id }));
            scheduler.updateTaskStatus(task.id, TaskStatus.RUNNING);
            
            log.info('dispatching task', { taskId: task.id });
            const patches = await this.dispatcher.dispatch(task);
            log.info('patches received', { taskId: task.id, count: patches.length });
            aggregator.addPatches(patches);
            
            scheduler.updateTaskStatus(task.id, TaskStatus.COMPLETED);
            this.retryCounters.delete(task.id);
            await this.eventBus.publish(this.createEvent(plan, EventType.TASK_COMPLETED, { taskId: task.id }));

            await this.checkpointManager.save(plan.planId, {
                taskStatuses: scheduler.getState(),
                patches: aggregator.getPatches(),
                retryCounters: Object.fromEntries(this.retryCounters)
            });
            await this.eventBus.publish(this.createEvent(plan, EventType.CHECKPOINT_CREATED, { planId: plan.planId, taskId: task.id }));

        } catch (error) {
            if (attempts < this.config.maxRetries) {
                scheduler.updateTaskStatus(task.id, TaskStatus.RETRYING);
                this.retryCounters.set(task.id, attempts + 1);
                
                await this.eventBus.publish(this.createEvent(plan, EventType.TASK_RETRYING, { taskId: task.id, attempt: attempts + 1 }));
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * this.config.baseBackoffMs));
                return this.executeTaskWithRetry(plan, task, scheduler, aggregator);
            } else {
                scheduler.updateTaskStatus(task.id, TaskStatus.FAILED);
                await this.eventBus.publish(this.createEvent(plan, EventType.TASK_FAILED, { taskId: task.id, error: String(error) }));
                throw error;
            }
        }
    }
}
