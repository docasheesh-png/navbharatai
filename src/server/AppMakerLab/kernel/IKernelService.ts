export enum ServiceState {
  UNINITIALIZED = 'UNINITIALIZED',
  INITIALIZING = 'INITIALIZING',
  RUNNING = 'RUNNING',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

export interface HealthReport {
  serviceName: string;
  serviceState: ServiceState;
  healthy: boolean;
  details?: string;
}

export interface IKernelService {
  readonly name: string;
  readonly dependencies: string[];
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<HealthReport>;
  getState(): ServiceState;
}
