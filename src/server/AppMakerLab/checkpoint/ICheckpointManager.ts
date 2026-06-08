import { Checkpoint } from './CheckpointTypes';

export interface ICheckpointManager {
    save(planId: string, state: any): Promise<void>;
    load(planId: string): Promise<any>;
    saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
    loadCheckpoint(id: string): Promise<Checkpoint>;
    deleteCheckpoint(id: string): Promise<void>;
    listCheckpoints(): Promise<Checkpoint[]>;
}
