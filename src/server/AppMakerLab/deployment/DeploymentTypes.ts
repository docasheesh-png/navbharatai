import { WorkspacePatchBatch } from '../mutation/MutationTypes';

export enum DeploymentState {
  PREPARING = 'PREPARING',
  ARTIFACT_BUILDING = 'ARTIFACT_BUILDING',
  VALIDATING = 'VALIDATING',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  ROLLING_BACK = 'ROLLING_BACK',
  FAILED = 'FAILED'
}

export interface DeploymentArtifact {
  artifactId: string;
  buildOutputPath: string;
  checksum: string;
  timestamp: number;
}

export interface DeploymentResult {
  success: boolean;
  deploymentId: string;
  deploymentUrl?: string;
  environment: string;
  rollbackAvailable: boolean;
  validationPassed: boolean;
  host: string;
  port: number;
  healthPath: string;
}

export interface DeploymentAuditRecord {
  deploymentId: string;
  artifactId: string;
  stateTransitions: DeploymentState[];
  validationResults: boolean;
  rollbackTriggered: boolean;
  durationMs: number;
  timestamp: number;
  // Extra fields for hardening wave
  attempt?: number;
  classification?: string;
  qualityScoreBefore?: number;
  qualityScoreAfter?: number;
  // Verification fields
  verificationStarted?: number;
  verificationPassed?: boolean;
  verificationFailed?: boolean;
  healthResponse?: string;
  verificationDurationMs?: number;
  verifiedHost?: string;
  verifiedPort?: number;
  verifiedEndpoint?: string;
  verificationAttempts?: number;
  allocatedPort?: number;
  releasedPort?: number;
  allocationTimestamp?: number;
  releaseTimestamp?: number;
}

export interface DeploymentPlan {
  deploymentType: string;
  frontendStack: string;
  backendStack: string;
  databaseStack: string;
  authStack: string;
  reasoning: string;
  port: number;
  healthPath: string;
}
