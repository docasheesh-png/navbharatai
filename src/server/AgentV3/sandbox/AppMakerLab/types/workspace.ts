
export interface WorkspaceMetadata {
    workspaceId: string;
    projectName: string;
    sourceType: 'generated' | 'cloned';
    status: 'idle' | 'creating' | 'ready' | 'error';
    createdAt: Date;
    updatedAt: Date;
}

export interface WorkspaceInfo extends WorkspaceMetadata {
    rootPath: string;
    files: string[];
}

export interface WorkspaceFileSummary {
    rootPath: string;
    files: string[];
}
