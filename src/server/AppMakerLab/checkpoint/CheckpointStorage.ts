import { readFile, writeFile, unlink, readdir, mkdir, rename } from 'fs/promises';
import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { join } from 'path';
import { Checkpoint } from './CheckpointTypes';

export class CheckpointStorage {
    private storageRoot = join(process.cwd(), '.checkpoints');

    constructor() {
        mkdir(this.storageRoot, { recursive: true }).catch(() => {});
    }

    async save(id: string, data: Checkpoint): Promise<void> {
        const filePath = join(this.storageRoot, `${id}.json`);
        const tmpPath = join(this.storageRoot, `${id}.json.tmp`);
        const content = JSON.stringify(data);

        const fd = openSync(tmpPath, 'w');
        try {
            writeSync(fd, content);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }

        await rename(tmpPath, filePath);

        const dirFd = openSync(this.storageRoot, 'r');
        try {
            fsyncSync(dirFd);
        } finally {
            closeSync(dirFd);
        }
    }

    async load(id: string): Promise<Checkpoint> {
        const filePath = join(this.storageRoot, `${id}.json`);
        const content = await readFile(filePath, 'utf-8');
        return JSON.parse(content);
    }

    async delete(id: string): Promise<void> {
        const filePath = join(this.storageRoot, `${id}.json`);
        await unlink(filePath).catch(() => {});
    }

    async list(): Promise<Checkpoint[]> {
        const files = await readdir(this.storageRoot);
        const checkpoints: Checkpoint[] = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const content = await readFile(join(this.storageRoot, file), 'utf-8');
                checkpoints.push(JSON.parse(content));
            }
        }
        return checkpoints;
    }
}
