import fs from 'fs';
import path from 'path';
import { ProjectMemory, InitialMemory } from './ProjectGraph';
import { MemoryIndexer } from './MemoryIndexer';

export class ProjectMemoryManager {
    private memoryPath = path.join(process.cwd(), 'project_memory.json');
    private memory: ProjectMemory;

    constructor() {
        if (fs.existsSync(this.memoryPath)) {
            this.memory = JSON.parse(fs.readFileSync(this.memoryPath, 'utf-8'));
        } else {
            this.memory = JSON.parse(JSON.stringify(InitialMemory));
            this.save();
        }
    }

    private save() {
        try {
            console.log(`Saving memory to ${this.memoryPath}`);
            fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2));
        } catch (e) {
            console.error('Failed to save memory:', e);
        }
    }

    update(filePath: string, content: string, request: string = '') {
        this.memory = MemoryIndexer.index(filePath, content, this.memory);
        if (request) {
            this.memory.buildHistory.push({
                timestamp: new Date().toISOString(),
                request,
                filesGenerated: [filePath],
                filesModified: []
            });
        }
        this.save();
    }

    getSummary() { return this.memory; }
}
