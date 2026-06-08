import { Commit, Branch, Tag } from './VCSTypes';

export interface IVCSProvider {
    commit(workspaceId: string, message: string, author?: { name: string; email: string }, correlationId?: string): Promise<Commit | string>;
    rollback(commitId: string): Promise<void>;
    createBranch(workspaceId: string, name: string, correlationId?: string): Promise<Branch>;
    deleteBranch(name: string): Promise<void>;
    createTag(name: string, commitId: string): Promise<Tag>;
    updateLKG(commitId: string): Promise<void>;
}
