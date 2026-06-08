import { GenerationTask } from './PlannerTypes';
import { TaskStatus } from './ExecutionTypes';

export class TaskScheduler {
    private tasks: GenerationTask[];
    private statuses: Map<string, TaskStatus> = new Map();

    constructor(tasks: GenerationTask[]) {
        this.tasks = tasks;
        this.tasks.forEach(task => this.statuses.set(task.id, TaskStatus.PENDING));
        this.validateDAG();
    }

    private validateDAG() {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (taskId: string): boolean => {
            visited.add(taskId);
            recursionStack.add(taskId);

            const task = this.tasks.find(t => t.id === taskId);
            if (task && task.dependencies) {
                // We need to be able to modify dependencies, so we take a copy
                const deps = [...task.dependencies];
                for (const depId of deps) {
                    if (!visited.has(depId)) {
                        if (hasCycle(depId)) return true;
                    } else if (recursionStack.has(depId)) {
                        console.warn(`Warning: Cyclic task dependency: ${taskId} -> ${depId}. Pruning edge.`);
                        task.dependencies = task.dependencies.filter(d => d !== depId);
                        return false; // Edge removed, continue
                    }
                }
            }

            recursionStack.delete(taskId);
            return false;
        };

        for (const task of this.tasks) {
            if (!visited.has(task.id)) {
                hasCycle(task.id);
            }
        }
    }

    getNextBatch(): GenerationTask[] {
        return this.tasks.filter(task => {
            if (this.statuses.get(task.id) !== TaskStatus.PENDING) return false;
            
            const dependencies = task.dependencies || [];
            return dependencies.every(depId => this.statuses.get(depId) === TaskStatus.COMPLETED);
        });
    }

    updateTaskStatus(taskId: string, status: TaskStatus) {
        this.statuses.set(taskId, status);
        if (status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
            this.cancelDownstream(taskId);
        }
    }

    private cancelDownstream(taskId: string) {
        const downstream = this.tasks.filter(t => t.dependencies?.includes(taskId));
        for (const task of downstream) {
            if (this.statuses.get(task.id) === TaskStatus.PENDING) {
                this.updateTaskStatus(task.id, TaskStatus.CANCELLED);
            }
        }
    }

    isComplete(): boolean {
        return Array.from(this.statuses.values()).every(
            status => status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED
        );
    }

    getState() {
        return Object.fromEntries(this.statuses);
    }

    restoreState(state: Record<string, TaskStatus>) {
        this.statuses = new Map(Object.entries(state));
    }
}
