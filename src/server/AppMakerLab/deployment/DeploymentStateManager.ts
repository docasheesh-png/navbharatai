import { DeploymentState } from './DeploymentTypes';
import * as fs from 'fs';
import * as path from 'path';

export class DeploymentStateManager {
  private baseDir = path.join(process.cwd(), 'deployments', 'state');

  constructor() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async persistState(deploymentId: string, state: object): Promise<void> {
    const tmpPath = path.join(this.baseDir, `${deploymentId}.tmp`);
    const finalPath = path.join(this.baseDir, `${deploymentId}.json`);

    fs.writeFileSync(tmpPath, JSON.stringify(state));
    const fd = fs.openSync(tmpPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    
    fs.renameSync(tmpPath, finalPath);
    
    // Directory fsync
    const dirFd = fs.openSync(this.baseDir, 'r');
    fs.fsyncSync(dirFd);
    fs.closeSync(dirFd);
  }

  async getState(deploymentId: string): Promise<any> {
    const filePath = path.join(this.baseDir, `${deploymentId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
}
