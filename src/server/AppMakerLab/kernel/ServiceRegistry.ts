import { IKernelService } from './IKernelService';
import { DependencyError } from './KernelErrors';

export class ServiceRegistry {
  private services: Map<string, IKernelService> = new Map();
  private locked: boolean = false;

  lock(): void {
    this.locked = true;
  }

  isLocked(): boolean {
    return this.locked;
  }

  register(service: IKernelService) {
    if (this.locked) {
      throw new DependencyError('Registry is locked');
    }
    if (this.services.has(service.name)) {
      throw new DependencyError(`Service ${service.name} already registered`);
    }
    this.services.set(service.name, service);
  }

  get(name: string): IKernelService {
    const service = this.services.get(name);
    if (!service) {
      throw new DependencyError(`Service ${name} not found`);
    }
    return service;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  getAll(): IKernelService[] {
    return Array.from(this.services.values());
  }

  validateDependencies(): void {
    for (const service of this.services.values()) {
      for (const dep of service.dependencies) {
        if (!this.services.has(dep)) {
          throw new DependencyError(`Service ${service.name} depends on non-existent service ${dep}`);
        }
      }
    }
    this.detectCycles();
  }

  private detectCycles(): void {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const checkCycles = (name: string) => {
      visited.add(name);
      recStack.add(name);

      const service = this.get(name);
      for (const dep of service.dependencies) {
        if (!visited.has(dep)) {
          if (checkCycles(dep)) return true;
        } else if (recStack.has(dep)) {
          return true;
        }
      }

      recStack.delete(name);
      return false;
    };

    for (const name of this.services.keys()) {
      if (!visited.has(name)) {
        if (checkCycles(name)) {
          throw new DependencyError('Circular dependency detected');
        }
      }
    }
  }

  getStartupOrder(): IKernelService[] {
    const visited = new Set<string>();
    const order: IKernelService[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      
      const service = this.get(name);
      for (const dep of service.dependencies) {
        visit(dep);
      }
      
      visited.add(name);
      order.push(service);
    };

    for (const name of this.services.keys()) {
      visit(name);
    }
    return order;
  }
}
