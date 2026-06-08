import { WorkspacePatchBatch } from './MutationTypes';
import { writeFile, unlink, mkdir, rename, rm, cp } from 'fs/promises';
import { join, dirname } from 'path';

export class TransactionalExecutor {
    private wsRoot = join(process.cwd(), 'workspace');
    private wsNew = join(process.cwd(), 'workspace_new');
    private wsOld = join(process.cwd(), 'workspace_old');

    async execute(batch: WorkspacePatchBatch): Promise<void> {
        // 1. Prepare staging: clone current workspace
        await rm(this.wsNew, { recursive: true, force: true }).catch(() => {});
        await mkdir(this.wsRoot, { recursive: true });
        await cp(this.wsRoot, this.wsNew, { recursive: true });

        // 2. Apply all patches in staging
        try {
            for (const patch of batch.patches) {
                const stagingPath = join(this.wsNew, patch.path);
                await mkdir(dirname(stagingPath), { recursive: true });
                if (patch.content === "") {
                    await unlink(stagingPath).catch(() => {});
                } else {
                    await writeFile(stagingPath, patch.content, 'utf-8');
                }
            }
        } catch (error) {
            await rm(this.wsNew, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    // Atomic promotion
    async promote(): Promise<void> {
        await rm(this.wsOld, { recursive: true, force: true }).catch(() => {});
        await rename(this.wsRoot, this.wsOld);
        await rename(this.wsNew, this.wsRoot);
    }

    async undo(batch: WorkspacePatchBatch): Promise<void> {
        await rm(this.wsNew, { recursive: true, force: true }).catch(() => {});
    }

    async recover(): Promise<void> {
        await rm(this.wsNew, { recursive: true, force: true }).catch(() => {});
        await rm(this.wsOld, { recursive: true, force: true }).catch(() => {});
    }
}
