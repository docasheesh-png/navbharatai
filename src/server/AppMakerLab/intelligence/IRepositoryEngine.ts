export interface IRepositoryEngine {
    indexRepository(): Promise<void>;
    analyzeImpact(filePaths: string[]): Promise<any>;
    getBlueprint(): Promise<any>;
    getDependencyGraph(): Promise<any>;
}
