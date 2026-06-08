import * as net from 'net';

export class PortManager {
    private static minPort = 3001;
    private static maxPort = 4000;
    private allocatedPorts: Set<number> = new Set();

    async allocatePort(): Promise<number> {
        for (let port = PortManager.minPort; port <= PortManager.maxPort; port++) {
            if (!this.allocatedPorts.has(port) && await this.isPortFree(port)) {
                this.allocatedPorts.add(port);
                return port;
            }
        }
        throw new Error('No free ports available');
    }

    releasePort(port: number): void {
        this.allocatedPorts.delete(port);
    }

    private isPortFree(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port);
        });
    }
}
