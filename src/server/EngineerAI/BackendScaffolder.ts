/**
 * Phase 14 — Bring Your Own Database.
 * Generates the provider-specific SDK setup file (src/lib/<provider>.ts) and
 * appends the required .env entries so the agent can use the user's hosted
 * database immediately without extra configuration steps.
 *
 * Critical invariant: NavBharatAI's own Firebase project is NEVER referenced here.
 * Every credential comes from the user's own account.
 */
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { DbProviderConfig } from './EngineerAITypes';

export interface ScaffoldResult {
  filesWritten: string[];
  npmPackages: string[];
  envVars: Record<string, string>;
  /** Short human-readable summary shown in the chat. */
  summary: string;
}

export class BackendScaffolder {
  async scaffold(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    switch (config.provider) {
      case 'supabase':   return this.scaffoldSupabase(workspaceId, config, actuator);
      case 'firebase':   return this.scaffoldFirebase(workspaceId, config, actuator);
      case 'mongodb':    return this.scaffoldMongoDB(workspaceId, config, actuator);
      case 'neon':       return this.scaffoldNeon(workspaceId, config, actuator);
      case 'appwrite':   return this.scaffoldAppwrite(workspaceId, config, actuator);
      case 'other':      return this.scaffoldOther(workspaceId, config, actuator);
    }
  }

  private async scaffoldSupabase(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const { url = '', anonKey = '' } = config.credentials;
    const libFile = `import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);
`;
    const envEntry = `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anonKey}\n`;
    await actuator.writeFile(workspaceId, 'src/lib/supabase.ts', libFile);
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['src/lib/supabase.ts', '.env'],
      npmPackages: ['@supabase/supabase-js'],
      envVars: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey },
      summary: 'Supabase client ready at src/lib/supabase.ts. Import { supabase } to query your database or manage auth.',
    };
  }

  private async scaffoldFirebase(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const c = config.credentials;
    const libFile = `import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID as string,
};

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);
`;
    const envEntry = [
      `VITE_FIREBASE_API_KEY=${c.apiKey ?? ''}`,
      `VITE_FIREBASE_AUTH_DOMAIN=${c.authDomain ?? ''}`,
      `VITE_FIREBASE_PROJECT_ID=${c.projectId ?? ''}`,
      `VITE_FIREBASE_STORAGE_BUCKET=${c.storageBucket ?? ''}`,
      `VITE_FIREBASE_MESSAGING_SENDER_ID=${c.messagingSenderId ?? ''}`,
      `VITE_FIREBASE_APP_ID=${c.appId ?? ''}`,
    ].join('\n') + '\n';
    await actuator.writeFile(workspaceId, 'src/lib/firebase.ts', libFile);
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['src/lib/firebase.ts', '.env'],
      npmPackages: ['firebase'],
      envVars: {
        VITE_FIREBASE_API_KEY: c.apiKey ?? '',
        VITE_FIREBASE_PROJECT_ID: c.projectId ?? '',
      },
      summary: 'Firebase client ready at src/lib/firebase.ts. Import { db, auth, storage } to use Firestore, Authentication, and Storage.',
    };
  }

  private async scaffoldMongoDB(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const { uri = '' } = config.credentials;
    // MongoDB is server-side only — generate a Node/Express helper, not a frontend client.
    const libFile = `import { MongoClient, Db } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI!);
let _db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (!_db) {
    await client.connect();
    _db = client.db();
  }
  return _db;
}
`;
    const envEntry = `MONGODB_URI=${uri}\n`;
    await actuator.writeFile(workspaceId, 'src/lib/mongodb.ts', libFile);
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['src/lib/mongodb.ts', '.env'],
      npmPackages: ['mongodb'],
      envVars: { MONGODB_URI: uri },
      summary: 'MongoDB Atlas client ready at src/lib/mongodb.ts. Call getDb() in your server routes to get a connected Db instance.',
    };
  }

  private async scaffoldNeon(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const { connectionString = '' } = config.credentials;
    const libFile = `import { neon } from '@neondatabase/serverless';

// sql is a tagged-template query function: sql\`SELECT * FROM users WHERE id = \${id}\`
export const sql = neon(process.env.DATABASE_URL!);
`;
    const envEntry = `DATABASE_URL=${connectionString}\n`;
    await actuator.writeFile(workspaceId, 'src/lib/db.ts', libFile);
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['src/lib/db.ts', '.env'],
      npmPackages: ['@neondatabase/serverless'],
      envVars: { DATABASE_URL: connectionString },
      summary: 'Neon Postgres client ready at src/lib/db.ts. Use the sql tagged-template for serverless queries.',
    };
  }

  private async scaffoldAppwrite(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const { endpoint = '', projectId = '' } = config.credentials;
    const libFile = `import { Client, Account, Databases, Storage } from 'appwrite';

export const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT as string)
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID as string);

export const account   = new Account(client);
export const databases = new Databases(client);
export const storage   = new Storage(client);
`;
    const envEntry = `VITE_APPWRITE_ENDPOINT=${endpoint}\nVITE_APPWRITE_PROJECT_ID=${projectId}\n`;
    await actuator.writeFile(workspaceId, 'src/lib/appwrite.ts', libFile);
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['src/lib/appwrite.ts', '.env'],
      npmPackages: ['appwrite'],
      envVars: { VITE_APPWRITE_ENDPOINT: endpoint, VITE_APPWRITE_PROJECT_ID: projectId },
      summary: 'Appwrite client ready at src/lib/appwrite.ts. Import { account, databases, storage } for auth, database, and file storage.',
    };
  }

  private async scaffoldOther(
    workspaceId: string,
    config: DbProviderConfig,
    actuator: IEngineerActuator,
  ): Promise<ScaffoldResult> {
    const { connectionString = '', apiKey = '' } = config.credentials;
    const name = config.platformName || 'custom';
    const envKey = connectionString ? 'DATABASE_URL' : 'API_KEY';
    const envVal = connectionString || apiKey;
    const envEntry = `${envKey}=${envVal}\n`;
    await this.appendEnv(workspaceId, envEntry, actuator);
    return {
      filesWritten: ['.env'],
      npmPackages: [],
      envVars: { [envKey]: envVal },
      summary: `${name} credentials added to .env as ${envKey}. Install the appropriate SDK and use process.env.${envKey} (server) or import.meta.env.VITE_${envKey} (client, after adding VITE_ prefix).`,
    };
  }

  /** Append env vars to the workspace .env without overwriting existing entries. */
  private async appendEnv(
    workspaceId: string,
    newEntries: string,
    actuator: IEngineerActuator,
  ): Promise<void> {
    let existing = '';
    try { existing = await actuator.readFile(workspaceId, '.env'); } catch { /* new file */ }
    const combined = existing.trimEnd() ? existing.trimEnd() + '\n' + newEntries : newEntries;
    await actuator.writeFile(workspaceId, '.env', combined);
  }
}

export const backendScaffolder = new BackendScaffolder();
