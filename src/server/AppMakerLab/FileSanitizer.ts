import path from 'path';
import { ValidationError } from './errors/AppMakerErrors';

export class FileSanitizer {
    /**
     * Resolves path and prevents path traversal attacks.
     * Ensures the path is within the workspace root.
     */
    static resolveSafePath(workspaceRoot: string, unsafePath: string): string {
        const root = path.resolve(workspaceRoot);
        const resolvedPath = path.resolve(root, unsafePath);
        
        // Strict boundary validation:
        // Must be the root itself OR start with "root/" (using platform separator)
        if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
            throw new ValidationError(`Unsafe file path traversal detected: ${unsafePath}`);
        }
        
        return resolvedPath;
    }

    static sanitizeFileName(name: string): string {
        return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    }

    static validateExtension(fileName: string, allowedExtensions: string[]): boolean {
        const ext = path.extname(fileName);
        return allowedExtensions.includes(ext);
    }
}
