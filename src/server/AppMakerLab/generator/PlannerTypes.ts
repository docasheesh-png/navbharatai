export interface GenerationTask {
  id: string;
  type: 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'AUTH' | 'CONFIG';
  name: string;
  path: string;
  dependencies: string[];
  contentDescription: string;
  priority: number;
  engine: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}
