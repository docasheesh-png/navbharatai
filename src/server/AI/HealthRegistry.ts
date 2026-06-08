type HealthStatus = 'healthy' | 'unstable' | 'blacklisted';

export class ModelHealthRegistry {
  private registry: Record<string, { status: HealthStatus; lastFailure: number; cooldown: number }> = {};
  private readonly namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  reportFailure(modelName: string) {
    const key = `${this.namespace}:${modelName}`;
    if (!this.registry[key]) {
      this.registry[key] = { status: 'unstable', lastFailure: Date.now(), cooldown: 60000 };
    } else {
      this.registry[key].status = 'blacklisted';
      this.registry[key].lastFailure = Date.now();
    }
  }

  isHealthy(modelName: string): boolean {
    const key = `${this.namespace}:${modelName}`;
    const entry = this.registry[key];
    if (!entry) return true;
    if (entry.status === 'healthy') return true;
    if (entry.status === 'blacklisted' && Date.now() - entry.lastFailure > entry.cooldown) {
      entry.status = 'unstable';
      return true;
    }
    return false;
  }

  getRegistry() {
    return this.registry;
  }
}
