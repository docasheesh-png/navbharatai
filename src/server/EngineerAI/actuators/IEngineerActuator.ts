export interface IEngineerActuator {
  ensureWorkspace(workspaceId: string): Promise<void>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  readFile(workspaceId: string, filePath: string): Promise<string>;
  listFiles(workspaceId: string): Promise<string[]>;
  build(workspaceId: string): Promise<{ success: boolean; logs: string }>;
}
