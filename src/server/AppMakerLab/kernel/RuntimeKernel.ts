import { IKernelService, ServiceState, HealthReport } from './IKernelService';
import { ServiceRegistry } from './ServiceRegistry';
import { KernelStateError, ServiceStartupError } from './KernelErrors';

export enum KernelState {
  UNINITIALIZED = 'UNINITIALIZED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

export interface KernelHealthReport {
  kernelState: KernelState;
  healthy: boolean;
  services: HealthReport[];
}

export class RuntimeKernel {
  private registry: ServiceRegistry = new ServiceRegistry();
  private state: KernelState = KernelState.UNINITIALIZED;

  constructor(services: IKernelService[]) {
    services.forEach(s => this.registry.register(s));
    this.registry.validateDependencies();
  }

  getState(): KernelState {
    return this.state;
  }

  getStartupOrder(): IKernelService[] {
    return this.registry.getStartupOrder();
  }

  getRegisteredServices(): IKernelService[] {
    return this.registry.getAll();
  }

  getService(name: string): IKernelService {
    return this.registry.get(name);
  }

  hasService(name: string): boolean {
    return this.registry.has(name);
  }

  async start(): Promise<void> {
    if (this.state !== KernelState.UNINITIALIZED && this.state !== KernelState.STOPPED) {
      throw new KernelStateError(`Cannot start from state ${this.state}`);
    }
    
    this.state = KernelState.STARTING;
    const startedServices: IKernelService[] = [];
    
    try {
      const order = this.registry.getStartupOrder();
      
      for (const service of order) {
        await service.start();
        if (service.getState() !== ServiceState.RUNNING) {
          throw new ServiceStartupError(`Service ${service.name} failed to set state to RUNNING`);
        }
        startedServices.push(service);
      }
      
      this.registry.lock();
      this.state = KernelState.RUNNING;
    } catch (error) {
      this.state = KernelState.FAILED;
      await this.rollback(startedServices);
      throw error;
    }
  }

  private async rollback(startedServices: IKernelService[]): Promise<void> {
    for (const service of startedServices.reverse()) {
      try {
        await service.stop();
      } catch {
        // Ignore secondary stop errors
      }
    }
  }

  async stop(): Promise<void> {
    if (this.state !== KernelState.RUNNING && this.state !== KernelState.FAILED) {
      throw new KernelStateError(`Cannot stop from state ${this.state}`);
    }

    this.state = KernelState.STOPPING;
    const order = this.registry.getStartupOrder().reverse();
    
    for (const service of order) {
      await service.stop();
      if (service.getState() !== ServiceState.STOPPED) {
        console.warn(`Service ${service.name} did not transition to STOPPED`);
      }
    }
    this.state = KernelState.STOPPED;
  }

  async healthCheck(): Promise<KernelHealthReport> {
    const services = this.registry.getAll();
    const reports: HealthReport[] = [];
    let allHealthy = true;

    for (const service of services) {
      const report = await service.healthCheck();
      if (!report.healthy) allHealthy = false;
      reports.push(report);
    }
    
    return {
      kernelState: this.state,
      healthy: allHealthy,
      services: reports,
    };
  }
}
