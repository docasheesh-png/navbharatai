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
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// No JWT_SECRET set: a random secret for THIS run only — never a fixed string, which anyone reading the code
// could use to forge a sign-in. Sign-ins reset when the server restarts; set JWT_SECRET to keep them.
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('[auth] JWT_SECRET is not set: using a random secret for this run. Sign-ins reset on restart.');

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
