import { IDeploymentEngine } from './IDeploymentEngine';
import { DeploymentResult, DeploymentState, DeploymentAuditRecord } from './DeploymentTypes';
import { DeploymentPlanner } from './DeploymentPlanner';
import { DeploymentArtifactBuilder } from './DeploymentArtifactBuilder';
import { DeploymentValidator } from './DeploymentValidator';
import { DeploymentStateManager } from './DeploymentStateManager';
import { DeploymentRollbackManager } from './DeploymentRollbackManager';
import { DeploymentAuditManager } from './DeploymentAuditManager';
import { PortManager } from '../../PreviewRunner/PortManager';
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { CheckpointStorage } from '../checkpoint/CheckpointStorage';
import { VCSProvider } from '../vcs/VCSProvider';
import { EventBus } from '../eventbus/EventBus';
import { Saga } from '../generator/Saga';

export class DeploymentEngine implements IDeploymentEngine {
  private planner = new DeploymentPlanner();
  private builder = new DeploymentArtifactBuilder();
  private validator = new DeploymentValidator();
  private stateManager = new DeploymentStateManager();
  private rollbackManager = new DeploymentRollbackManager();
  private auditManager = new DeploymentAuditManager();
  private portManager = new PortManager();
  private checkpoint = new CheckpointManager(new CheckpointStorage(), this.eventBus);
  private vcs = new VCSProvider();
  private eventBus = new EventBus();

  async runDeployment(workspaceId: string): Promise<DeploymentResult> {
    const deploymentId = `dep-${Date.now()}`;
    const startTime = Date.now();
    const stateTransitions: DeploymentState[] = [DeploymentState.PREPARING];
    const allocationTimestamp = Date.now();
    
    await this.eventBus.publish('DEPLOYMENT_STARTED', { workspaceId, deploymentId });
    await this.checkpoint.saveCheckpoint(workspaceId);
    await this.vcs.commit(workspaceId, `Deployment start: ${deploymentId}`);

    // P-ORCH.3 — saga compensation: now that the start checkpoint/commit external effects have landed,
    // register their compensation. On ANY later step failure the saga runs the registered compensations
    // in reverse (here: roll the workspace back) — an ordered, extensible mechanism replacing the ad-hoc
    // rollback call (future stages can register their own compensations, undone newest-first).
    const saga = new Saga();
    saga.register('rollback-workspace', () => this.rollbackManager.rollback(workspaceId));

    let artifact: any;
    let verification: any = { passed: false };
    let plan: any;

    try {
      plan = await this.planner.plan(workspaceId);
      await this.stateManager.persistState(deploymentId, { state: DeploymentState.ARTIFACT_BUILDING, plan });
      stateTransitions.push(DeploymentState.ARTIFACT_BUILDING);
      
      artifact = await this.builder.build(workspaceId);
      await this.eventBus.publish('DEPLOYMENT_ARTIFACT_BUILT', { workspaceId, deploymentId });
      
      await this.stateManager.persistState(deploymentId, { state: DeploymentState.VALIDATING });
      stateTransitions.push(DeploymentState.VALIDATING);
      const isValid = await this.validator.validate(workspaceId);
      if (!isValid) throw new Error('Validation failed');
      await this.eventBus.publish('DEPLOYMENT_VALIDATED', { workspaceId, deploymentId });
      
      await this.stateManager.persistState(deploymentId, { state: DeploymentState.DEPLOYED });
      stateTransitions.push(DeploymentState.DEPLOYED);
      await this.eventBus.publish('DEPLOYMENT_DEPLOYED', { workspaceId, deploymentId });
      
      // Live verification
      const verifyStart = Date.now();
      verification = await this.verifyDeployment(artifact, plan);
      if (!verification.passed) throw new Error('Verification failed');
      
      await this.eventBus.publish('DEPLOYMENT_COMPLETED', { workspaceId, deploymentId });
      
      await this.persistAudit(deploymentId, artifact.artifactId, stateTransitions, true, false, startTime, verifyStart, verification, plan, allocationTimestamp);
      return { success: true, deploymentId, environment: 'LOCAL', rollbackAvailable: true, validationPassed: true, host: 'localhost', port: plan.port, healthPath: plan.healthPath };
    } catch (e) {
      // P-ORCH.3 — run the saga's registered compensations in reverse (rolls the workspace back).
      await saga.compensate();
      stateTransitions.push(DeploymentState.FAILED);
      await this.stateManager.persistState(deploymentId, { state: DeploymentState.FAILED });
      await this.eventBus.publish('DEPLOYMENT_FAILED', { workspaceId, deploymentId });
      await this.eventBus.publish('DEPLOYMENT_ROLLED_BACK', { workspaceId, deploymentId });
      
      const auditPlan = plan || await this.planner.plan(workspaceId).catch(() => ({port: 0, healthPath: ''} as any));
      await this.persistAudit(deploymentId, artifact?.artifactId || 'N/A', stateTransitions, false, true, startTime, Date.now(), verification, auditPlan, allocationTimestamp);
      return { success: false, deploymentId, environment: 'LOCAL', rollbackAvailable: true, validationPassed: false, host: 'localhost', port: 0, healthPath: '' };
    } finally {
      if (plan && plan.port) {
        this.portManager.releasePort(plan.port);
      }
    }
  }

  private async verifyDeployment(artifact: any, plan: any): Promise<{passed: boolean, response?: string}> {
      const fs = require('fs');
      if (!fs.existsSync(artifact.buildOutputPath)) return { passed: false, response: 'Artifact not found' };
      
      return new Promise((resolve) => {
          const http = require('http');
          const options = { hostname: 'localhost', port: plan.port, path: plan.healthPath, method: 'GET' };
          
          let attempts = 0;
          const poll = () => {
              attempts++;
              const req = http.request(options, (res: any) => {
                  if (res.statusCode >= 200 && res.statusCode < 300) {
                      resolve({ passed: true, response: `Status: ${res.statusCode}` });
                  } else {
                      if (attempts < 5) setTimeout(poll, 1000);
                      else resolve({ passed: false, response: `Status: ${res.statusCode}` });
                  }
              });
              req.on('error', () => {
                  if (attempts < 5) setTimeout(poll, 1000);
                  else resolve({ passed: false, response: 'Connection error' });
              });
              req.end();
          };
          poll();
      });
  }

  private async persistAudit(
    deploymentId: string, 
    artifactId: string, 
    stateTransitions: DeploymentState[], 
    validationResults: boolean, 
    rollbackTriggered: boolean,
    startTime: number,
    verifyStart: number,
    verification: {passed: boolean, response?: string},
    plan: any,
    allocationTimestamp: number
  ): Promise<void> {
    const record: DeploymentAuditRecord = {
      deploymentId,
      artifactId,
      stateTransitions,
      validationResults,
      rollbackTriggered,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
      verificationStarted: verifyStart,
      verificationPassed: verification.passed,
      verificationFailed: !verification.passed,
      healthResponse: verification.response,
      verificationDurationMs: Date.now() - verifyStart,
      verifiedHost: 'localhost',
      verifiedPort: plan.port,
      verifiedEndpoint: plan.healthPath,
      verificationAttempts: 5,
      allocatedPort: plan.port,
      releasedPort: plan.port,
      allocationTimestamp: allocationTimestamp,
      releaseTimestamp: Date.now()
    };
    await this.auditManager.persistAudit(record);
  }
}
