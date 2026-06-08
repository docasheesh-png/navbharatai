import simpleGit, { SimpleGit } from 'simple-git';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { IVCSProvider } from './IVCSProvider';
import { IEventBus } from '../eventbus/IEventBus';
import { EventType } from '../eventbus/EventTypes';
import { FileSanitizer } from '../FileSanitizer';
import { StatusResult } from './VCSTypes';
import { ValidationError, PersistenceError } from '../errors/AppMakerErrors';

export class LocalGitProvider implements IVCSProvider {
    constructor(
        private workspacesRoot: string,
        private eventBus: IEventBus
    ) {}

    private async getGit(workspaceId: string): Promise<SimpleGit> {
        const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        return simpleGit(workspacePath);
    }

    private getLkgPath(workspaceId: string): string {
        return FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId, 'lkg.json');
    }

    private async publishEvent(type: EventType, workspaceId: string, correlationId: string, payload: Record<string, unknown>) {
        await this.eventBus.publish({
            eventId: randomUUID(),
            correlationId,
            workspaceId,
            sender: 'LocalGitProvider',
            timestamp: new Date(),
            type,
            payload
        });
    }

    private async handleError(workspaceId: string, correlationId: string, operation: string, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await this.publishEvent(EventType.VCS_FAILED, workspaceId, correlationId, { operation, error: message });
        throw new PersistenceError(`VCS Operation failed: ${operation}. ${message}`);
    }

    async init(workspaceId: string, correlationId: string): Promise<void> {
        try {
            const git = await this.getGit(workspaceId);
            await git.init();
            await this.publishEvent(EventType.VCS_INITIALIZED, workspaceId, correlationId, { action: 'GitInit' });
        } catch (e) {
            await this.handleError(workspaceId, correlationId, 'init', e);
        }
    }

    async clone(workspaceId: string, repoUrl: string, correlationId: string): Promise<void> {
        try {
            const url = new URL(repoUrl);
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new ValidationError('Unsafe repo protocol');
            }
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                throw new ValidationError('Unsafe host');
            }
            const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
            const git = simpleGit();
            await git.clone(repoUrl, workspacePath);
            await this.publishEvent(EventType.VCS_CLONED, workspaceId, correlationId, { repoUrl });
        } catch (e) {
            await this.handleError(workspaceId, correlationId, 'clone', e);
        }
    }

    async createBranch(workspaceId: string, name: string, correlationId?: string): Promise<Branch> {
        try {
            const git = await this.getGit(workspaceId);
            if (!/^[a-zA-Z0-9._/-]+$/.test(name)) {
                throw new ValidationError('Invalid branch name');
            }
            await git.checkoutLocalBranch(name);
            if (correlationId) {
                await this.publishEvent(EventType.VCS_BRANCH_CREATED, workspaceId, correlationId, { branchName: name });
            }
            return { name, commitId: 'unknown' };
        } catch (e) {
            if (correlationId) {
                await this.handleError(workspaceId, correlationId, 'createBranch', e);
            }
            throw e;
        }
    }

    async checkoutBranch(workspaceId: string, branchName: string, correlationId: string): Promise<void> {
        try {
            const git = await this.getGit(workspaceId);
            await git.checkout(branchName);
            await this.publishEvent(EventType.VCS_CHECKOUT, workspaceId, correlationId, { branchName });
        } catch (e) {
            await this.handleError(workspaceId, correlationId, 'checkoutBranch', e);
        }
    }

    async commit(workspaceId: string, message: string, author?: { name: string; email: string }, correlationId?: string): Promise<Commit> {
        try {
            if (author && (!author.name || author.name.length > 100 || /[<>]/.test(author.name) || 
                !author.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author.email) || author.email.length > 255)) {
                throw new ValidationError('Invalid commit author');
            }
            const git = await this.getGit(workspaceId);
            await git.add(['.']);
            const commitOptions: { [key: string]: string } = {};
            if (author) {
                commitOptions['--author'] = `${author.name} <${author.email}>`;
            }
            const result = await git.commit(message, [], commitOptions);
            if (correlationId) {
                await this.publishEvent(EventType.VCS_COMMITTED, workspaceId, correlationId, { commitHash: result.commit });
            }
            return { id: result.commit, message, timestamp: Date.now(), parentIds: [] };
        } catch (e) {
            if (correlationId) {
                await this.handleError(workspaceId, correlationId, 'commit', e);
            }
            throw e;
        }
    }

    async status(workspaceId: string): Promise<StatusResult> {
        const git = await this.getGit(workspaceId);
        const status = await git.status();
        return {
            not_added: status.not_added,
            conflicted: status.conflicted,
            created: status.created,
            deleted: status.deleted,
            modified: status.modified,
            renamed: status.renamed.map(r => r.to),
            ahead: status.ahead,
            behind: status.behind,
            current: status.current || 'main'
        };
    }

    async getDiff(workspaceId: string, fromCommit: string, toCommit: string): Promise<string> {
        const git = await this.getGit(workspaceId);
        return await git.diff([fromCommit, toCommit]);
    }

    async revert(workspaceId: string, commitHash: string, correlationId: string): Promise<void> {
        try {
            const git = await this.getGit(workspaceId);
            const isRepo = await git.checkIsRepo();
            if (!isRepo) throw new PersistenceError('Not a repository');
            
            try {
                await git.revparse(['--verify', commitHash]);
            } catch {
                throw new ValidationError('Commit not found');
            }
            
            await git.revert([commitHash]);
            await this.publishEvent(EventType.VCS_REVERTED, workspaceId, correlationId, { commitHash });
        } catch (e) {
            await this.handleError(workspaceId, correlationId, 'revert', e);
        }
    }

    async markLastKnownGood(workspaceId: string, commitHash: string, correlationId: string): Promise<void> {
        try {
            const git = await this.getGit(workspaceId);
            await git.revparse(['--verify', commitHash]);

            const lkgPath = this.getLkgPath(workspaceId);
            await fs.writeFile(lkgPath, JSON.stringify({ commitHash, timestamp: new Date().toISOString() }));
            
            await this.publishEvent(EventType.VCS_LAST_KNOWN_GOOD_SET, workspaceId, correlationId, { commitHash });
        } catch (e) {
            await this.handleError(workspaceId, correlationId, 'markLastKnownGood', e);
        }
    }

    async getLastKnownGood(workspaceId: string): Promise<string | null> {
        try {
            const lkgPath = this.getLkgPath(workspaceId);
            const content = await fs.readFile(lkgPath, 'utf8');
            const data = JSON.parse(content);
            return data.commitHash;
        } catch {
            return null;
        }
    }
}
