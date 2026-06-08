import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ProjectMemoryManager } from '../Memory/ProjectMemoryManager';

export class WorkspaceManager {
  private transactionStack: Array<() => void> = [];
  private operationLog: string[] = [];
  private memoryManager: ProjectMemoryManager;

  constructor() {
    this.memoryManager = new ProjectMemoryManager();
  }

  private validatePath(filePath: string): string {
    const workspaceRoot = process.cwd();
    const absolutePath = path.resolve(workspaceRoot, filePath);
    if (!absolutePath.startsWith(workspaceRoot)) {
      throw new Error(`Access denied: ${filePath} is outside workspace`);
    }
    return absolutePath;
  }

  async createFile(filePath: string, content: string, overwrite: boolean = false): Promise<void> {
    const absolutePath = this.validatePath(filePath);
    if (!overwrite && fs.existsSync(absolutePath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    
    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content);
    this.memoryManager.update(filePath, content);
    this.operationLog.push(`Created: ${filePath}`);
    this.transactionStack.push(() => {
      // Only rollback if it was newly created (not overwritten)
      if (!overwrite && fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    });
  }

  async modifyFile(filePath: string, newContent: string): Promise<void> {
    const absolutePath = this.validatePath(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const oldContent = fs.readFileSync(absolutePath, 'utf8');
    fs.writeFileSync(absolutePath, newContent);
    this.memoryManager.update(filePath, newContent);
    this.operationLog.push(`Modified: ${filePath}`);
    this.transactionStack.push(() => {
      fs.writeFileSync(absolutePath, oldContent);
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    const absolutePath = this.validatePath(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const oldContent = fs.readFileSync(absolutePath, 'utf8');
    fs.unlinkSync(absolutePath);
    // this.memoryManager.delete(filePath); // Would need to add del method
    this.operationLog.push(`Deleted: ${filePath}`);
    this.transactionStack.push(() => {
      fs.writeFileSync(absolutePath, oldContent);
    });
  }

  async createDirectory(dirPath: string): Promise<void> {
    const absolutePath = this.validatePath(dirPath);
    if (fs.existsSync(absolutePath)) {
      throw new Error(`Directory already exists: ${dirPath}`);
    }
    fs.mkdirSync(absolutePath, { recursive: true });
    this.operationLog.push(`Created Directory: ${dirPath}`);
    this.transactionStack.push(() => {
      if (fs.existsSync(absolutePath)) fs.rmdirSync(absolutePath);
    });
  }

  readFile(filePath: string): string {
    const absolutePath = this.validatePath(filePath);
    return fs.readFileSync(absolutePath, 'utf8');
  }

  listFiles(dirPath: string): string[] {
    const absolutePath = this.validatePath(dirPath);
    return fs.readdirSync(absolutePath);
  }

  executeCommand(command: string): string {
    // Whitelist allowed commands
    const allowedCommands = ['npm', 'ls', 'grep'];
    const cmd = command.split(' ')[0];
    if (!allowedCommands.includes(cmd)) {
        throw new Error(`Command not allowed: ${cmd}`);
    }
    const output = execSync(command, { encoding: 'utf8' });
    this.operationLog.push(`Executed: ${command}`);
    return output;
  }

  rollback(): void {
    while (this.transactionStack.length > 0) {
      const undo = this.transactionStack.pop();
      if (undo) undo();
    }
    this.operationLog.push('Rollback executed');
  }

  getOperationLog(): string[] {
    return this.operationLog;
  }
}
