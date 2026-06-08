import { ProjectMemory } from './ProjectGraph';

export class MemoryIndexer {
  static index(filePath: string, content: string, memory: ProjectMemory): ProjectMemory {
    // Very simple extraction logic
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        if (content.includes('export default function') || content.includes('export const')) {
            const match = content.match(/export (?:default )?(?:const|function|class) (\w+)/);
            if (match && match[1]) {
                const componentName = match[1];
                if (!memory.components.includes(componentName)) {
                    memory.components.push(componentName);
                }
            }
        }
    }
    if (!memory.files.includes(filePath)) {
        memory.files.push(filePath);
    }
    return memory;
  }
}
