import * as fs from 'fs';
import * as path from 'path';
import { DeploymentAuditRecord } from './DeploymentTypes';

export class DeploymentAuditManager {
  private baseDir = path.join(process.cwd(), 'deployments', 'audit');

  constructor() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async persistAudit(record: DeploymentAuditRecord): Promise<void> {
    const filePath = path.join(this.baseDir, `${record.deploymentId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    
    // Fsync the file
    const fd = fs.openSync(filePath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  }
}
