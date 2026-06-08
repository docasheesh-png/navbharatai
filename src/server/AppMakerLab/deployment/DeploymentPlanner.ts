import { BlueprintCompiler } from '../intelligence/BlueprintCompiler';
import { PatternResolutionEngine } from '../intelligence/PatternResolutionEngine';
import { RepositoryIntelligenceEngine } from '../intelligence/RepositoryIntelligenceEngine';
import { DeploymentPlan } from './DeploymentTypes';
import { PortManager } from '../../PreviewRunner/PortManager';

export class DeploymentPlanner {
  private compiler = new BlueprintCompiler();
  private patternEngine = new PatternResolutionEngine();
  private repoEngine = new RepositoryIntelligenceEngine();
  private portManager = new PortManager();

  async plan(workspaceId: string): Promise<DeploymentPlan> {
    const blueprint = await this.compiler.compile(workspaceId);
    const patterns = await this.patternEngine.resolve(workspaceId);
    
    // Logic to determine deployment details based on blueprint
    let deploymentType = 'STATIC_SITE';
    const hasBackend = (blueprint.apiEndpoints && blueprint.apiEndpoints.length > 0);
    
    if (hasBackend) {
      if (patterns.includes('FULLSTACK')) {
        deploymentType = 'FULLSTACK';
      } else {
        deploymentType = 'NODE_SERVER';
      }
    }

    const port = await this.portManager.allocatePort();

    return {
      deploymentType,
      frontendStack: blueprint.type || 'React',
      backendStack: hasBackend ? 'Node.js/Express' : 'None',
      databaseStack: blueprint.entities.length > 0 ? 'Firestore' : 'None',
      authStack: 'Firebase Auth',
      reasoning: `Inferred based on blueprint: ${blueprint.name} (type: ${blueprint.type}) and ${blueprint.apiEndpoints.length} API endpoints.`,
      port: port,
      healthPath: '/api/health'
    };
  }
}
