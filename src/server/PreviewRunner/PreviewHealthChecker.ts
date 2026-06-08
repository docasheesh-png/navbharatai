export enum HealthStatus {
    HEALTHY = 'HEALTHY',
    UNHEALTHY = 'UNHEALTHY',
    TIMEOUT = 'TIMEOUT'
}

export class PreviewHealthChecker {
    async check(url: string, timeoutMs: number = 30000): Promise<HealthStatus> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const response = await fetch(url);
                if (response.ok) return HealthStatus.HEALTHY;
            } catch (e) {
                // Wait and retry
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return HealthStatus.TIMEOUT;
    }
}
