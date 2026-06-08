import { readFile, writeFile, mkdir, rename, rm, readdir } from 'fs/promises';
import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { join } from 'path';
import { VCSState } from './VCSTypes';

export type TransactionPhase = 'PREPARING' | 'CHECKPOINT_PREPARED' | 'VCS_COMMITTED' | 'FINALIZED' | 'ROLLED_BACK';

export interface TransactionRecord {
    id: string;
    phase: TransactionPhase;
    commitHash?: string;
    previousCommitHash?: string;
    checkpointId: string;
    timestamp: number;
}

export class VCSStateManager {
    private root = join(process.cwd(), '.vcs_state');
    private txDir = join(this.root, 'transactions');
    private stateFile = join(this.root, 'state.json');

    constructor() {
        this.init();
    }

    private async init() {
        await mkdir(this.txDir, { recursive: true });
    }

    private async atomicWrite(filePath: string, data: any) {
        const tmpPath = `${filePath}.tmp`;
        const content = JSON.stringify(data);
        const fd = openSync(tmpPath, 'w');
        try {
            writeSync(fd, content);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        await rename(tmpPath, filePath);
        const dirFd = openSync(this.root, 'r');
        try {
            fsyncSync(dirFd);
        } finally {
            closeSync(dirFd);
        }
    }

    async listTransactions(): Promise<TransactionRecord[]> {
        const files = await readdir(this.txDir);
        const records: TransactionRecord[] = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const content = await readFile(join(this.txDir, file), 'utf-8');
                records.push(JSON.parse(content));
            }
        }
        return records;
    }

    async getTransaction(id: string): Promise<TransactionRecord | null> {
        try {
            const content = await readFile(join(this.txDir, `${id}.json`), 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    async saveTransaction(record: TransactionRecord): Promise<void> {
        await this.atomicWrite(join(this.txDir, `${record.id}.json`), record);
    }

    async updateTransactionPhase(id: string, phase: TransactionPhase): Promise<void> {
        const record = await this.getTransaction(id);
        if (record) {
            record.phase = phase;
            await this.saveTransaction(record);
        }
    }

    async getState(): Promise<VCSState> {
        try {
            const content = await readFile(this.stateFile, 'utf-8');
            return JSON.parse(content);
        } catch {
            return { head: 'INITIAL', branches: [], tags: [], LKGCommitHash: 'INITIAL' };
        }
    }

    async saveState(state: VCSState): Promise<void> {
        await this.atomicWrite(this.stateFile, state);
    }
}
