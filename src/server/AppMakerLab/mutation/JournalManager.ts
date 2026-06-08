import { JournalEntry } from './MutationTypes';
import { appendFile, readFile } from 'fs/promises';
import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { join } from 'path';

export class JournalManager {
    private journalPath = join(process.cwd(), 'workspace_journal.jsonl');

    async write(entry: JournalEntry): Promise<void> {
        const line = JSON.stringify(entry) + '\n';
        const fd = openSync(this.journalPath, 'a');
        try {
            writeSync(fd, line);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
    }

    async readAll(): Promise<JournalEntry[]> {
        try {
            const data = await readFile(this.journalPath, 'utf-8');
            return data.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        } catch {
            return [];
        }
    }
}
