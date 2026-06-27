/**
 * Phase 10 — Database + Auth + Storage Provisioning
 *
 * Generates scaffold files for common backend patterns so the agent
 * can build auth/DB/storage features without writing boilerplate from scratch.
 * The actual DB is started by the actuator (E2BActuator for real provisioning;
 * LocalActuator throws since it can't run daemon services in a live deploy).
 */

const DB_LIB = `import { Pool } from 'pg';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = pool;
export default pool;
`;

const AUTH_LIB = `import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'please-set-JWT_SECRET-env-var';

export const hashPw = (password: string) => bcrypt.hash(password, 10);
export const checkPw = (password: string, hash: string) => bcrypt.compare(password, hash);
export const signJwt = (payload: object, expiresIn = '7d') =>
  jwt.sign(payload, SECRET, { expiresIn } as jwt.SignOptions);
export const verifyJwt = <T = unknown>(token: string) => jwt.verify(token, SECRET) as T;
`;

const STORAGE_LIB = `import fs from 'fs/promises';
import path from 'path';

const DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads');

export async function saveFile(filename: string, data: Buffer): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  const dest = path.join(DIR, filename);
  await fs.writeFile(dest, data);
  return dest;
}

export async function readFile(filename: string): Promise<Buffer> {
  return fs.readFile(path.join(DIR, filename));
}

export async function deleteFile(filename: string): Promise<void> {
  await fs.unlink(path.join(DIR, filename)).catch(() => {});
}
`;

export interface ScaffoldFile {
  path: string;
  content: string;
}

export class BackendProvisioner {
  /** Return scaffold files for the requested features. */
  static getScaffoldFiles(features: ('db' | 'auth' | 'storage')[]): ScaffoldFile[] {
    const files: ScaffoldFile[] = [];
    if (features.includes('db'))      files.push({ path: 'src/lib/db.ts',      content: DB_LIB });
    if (features.includes('auth'))    files.push({ path: 'src/lib/auth.ts',    content: AUTH_LIB });
    if (features.includes('storage')) files.push({ path: 'src/lib/storage.ts', content: STORAGE_LIB });
    return files;
  }

  /** npm packages that need to be installed for the requested features. */
  static getPackages(features: ('db' | 'auth' | 'storage')[]): string[] {
    const pkgs: string[] = [];
    if (features.includes('db'))   pkgs.push('pg', '@types/pg');
    if (features.includes('auth')) pkgs.push('bcrypt', 'jsonwebtoken', '@types/bcrypt', '@types/jsonwebtoken');
    return pkgs;
  }
}
