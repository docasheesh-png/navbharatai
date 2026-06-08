export type VCSPhase = 'PREPARE' | 'COMMIT' | 'ROLLBACK';

export interface Commit {
    id: string;
    message: string;
    timestamp: number;
    parentIds: string[];
}

export interface Branch {
    name: string;
    commitId: string;
}

export interface Tag {
    name: string;
    commitId: string;
}

export interface VCSState {
    head: string;
    branches: Branch[];
    tags: Tag[];
    LKGCommitHash: string;
}
