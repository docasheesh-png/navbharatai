
export interface WorkspaceConfig {
  workspaceId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived' | 'deleted';
}

export type EventOperation = 
  | 'WORKSPACE_CREATED'
  | 'WORKSPACE_LOADED'
  | 'WORKSPACE_SAVED'
  | 'WORKSPACE_DELETED'
  | 'FILE_CREATED'
  | 'FILE_UPDATED'
  | 'FILE_DELETED'
  | 'FILE_RENAMED'
  | 'DIRECTORY_CREATED'
  | 'DIRECTORY_DELETED'
  | 'SNAPSHOT_CREATED'
  | 'SNAPSHOT_RESTORED';

export interface WorkspaceEvent {
  event: EventOperation;
  workspaceId: string;
  path?: string;
  timestamp: string;
}
