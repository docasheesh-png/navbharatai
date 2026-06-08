export interface IDEFile {
  name: string;
  content: string;
  language: string;
  path: string;
}

export interface IDEProject {
  id: string;
  name: string;
  files: Record<string, string>;
}

export type IDEScreen = 'files' | 'search' | 'git' | 'extensions' | 'settings' | 'ai' | 'preview' | 'debug' | 'security' | 'shortcuts' | 'cursor';

export interface TerminalLine {
  text: string;
  type: 'info' | 'error' | 'success' | 'input' | 'warn';
}

export interface Tab {
  path: string;
  isDirty?: boolean;
}
