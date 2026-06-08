import { GenerationTask } from './PlannerTypes';

export interface GenerationPlan {
  planId: string;
  workspaceId: string;
  correlationId: string;
  blueprintId: string;
  blueprintHash: string;
  tasks: GenerationTask[];
  createdAt: string;
}
