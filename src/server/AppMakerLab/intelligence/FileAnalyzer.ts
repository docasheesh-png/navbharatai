import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as ts from 'typescript';

export class FileAnalyzer {
    async analyze(filePath: string): Promise<any> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
        
        const symbols: any[] = [];
        const dependencies: string[] = [];

        function visit(node: ts.Node) {
            if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                dependencies.push(node.moduleSpecifier.text);
            }
            if (ts.isClassDeclaration(node) && node.name) {
                symbols.push({ type: 'class', name: node.name.text });
            }
            if (ts.isFunctionDeclaration(node) && node.name) {
                symbols.push({ type: 'function', name: node.name.text });
            }
            if (ts.isInterfaceDeclaration(node)) {
                symbols.push({ type: 'interface', name: node.name.text });
            }
            if (ts.isEnumDeclaration(node)) {
                symbols.push({ type: 'enum', name: node.name.text });
            }
            if (ts.isTypeAliasDeclaration(node)) {
                symbols.push({ type: 'type', name: node.name.text });
            }
            ts.forEachChild(node, visit);
        }
        
        visit(sourceFile);

        return {
            path: filePath,
            tech: [path.extname(filePath).replace('.', '')],
            dependencies,
            symbols,
            contentHash: hash
        };
    }
}
