import { DeploymentResult } from './DeploymentTypes';

export interface IDeploymentEngine {
  runDeployment(workspaceId: string): Promise<DeploymentResult>;
}
