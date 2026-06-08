import { IRepositoryEngine } from './IRepositoryEngine';
import { RepositoryIndex, FileMetadata } from './RepositoryIndex';
import { FileAnalyzer } from './FileAnalyzer';
import { GraphGenerator } from './GraphGenerator';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import { BlueprintReconstructor } from './BlueprintReconstructor';
import * as fs from 'fs';
import * as path from 'path';

export class RepositoryIntelligenceEngine implements IRepositoryEngine {
    private index = new RepositoryIndex();
    private analyzer = new FileAnalyzer();
    private grapher = new GraphGenerator();
    private impact = new ImpactAnalyzer();
    private architect = new BlueprintReconstructor();
    private techStack: any = {};

    async indexRepository(): Promise<void> {
        this.techStack = this.detectTechStack();
        await this.traverse(process.cwd());
    }

    private detectTechStack(): any {
        const pkgPath = path.join(process.cwd(), 'package.json');
        if (!fs.existsSync(pkgPath)) return {};
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return {
            react: !!deps['react'],
            next: !!deps['next'],
            express: !!deps['express'],
            node: !!deps['node'],
            typescript: !!deps['typescript'] || !!deps['@types/node']
        };
    }

    private async traverse(dir: string): Promise<void> {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                await this.traverse(fullPath);
            } else if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md'].includes(path.extname(file))) {
                const meta = await this.analyzer.analyze(fullPath);
                const existing = await this.index.get(fullPath);
                if (!existing || existing.contentHash !== meta.contentHash) {
                    await this.index.update(fullPath, meta as FileMetadata);
                }
            }
        }
    }

    async analyzeImpact(filePaths: string[]): Promise<any> {
        const graph = this.grapher.generate(await this.index.getAll());
        return this.impact.analyze(filePaths, graph);
    }

    async getBlueprint(): Promise<any> {
        const graph = this.grapher.generate(await this.index.getAll());
        return this.architect.reconstruct(graph, await this.index.getAll());
    }

    async getDependencyGraph(): Promise<any> {
        return this.grapher.generate(await this.index.getAll());
    }
}
