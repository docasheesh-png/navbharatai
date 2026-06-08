export interface FileMetadata {
    path: string;
    tech: string[];
    dependencies: string[];
    symbols: { type: string, name: string }[];
    contentHash: string;
}

export class RepositoryIndex {
    private index: Map<string, FileMetadata> = new Map();
    private symbolGraph: Map<string, string> = new Map();

    async update(path: string, meta: FileMetadata): Promise<void> {
        this.index.set(path, meta);
        for(const sym of meta.symbols) {
            this.symbolGraph.set(sym.name, path);
        }
    }

    async get(path: string): Promise<FileMetadata | undefined> {
        return this.index.get(path);
    }

    async getAll(): Promise<FileMetadata[]> {
        return Array.from(this.index.values());
    }

    async prune(existingPaths: Set<string>): Promise<void> {
        for (const path of this.index.keys()) {
            if (!existingPaths.has(path)) {
                this.index.delete(path);
                // Note: Rebuilding symbol graph is easier than surgical removal for now
                this.symbolGraph.clear();
                for (const meta of this.index.values()) {
                    for (const sym of meta.symbols) {
                        this.symbolGraph.set(sym.name, meta.path);
                    }
                }
            }
        }
    }

    getSymbolDefinition(name: string): string | undefined {
        return this.symbolGraph.get(name);
    }
}
