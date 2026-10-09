/**
 * A CREDENTIAL MUST NOT OUTLIVE THE ACCOUNT IT BELONGS TO.
 *
 * 🔴 THE CLASS — `DELETE /api/profile` deletes the Firebase Auth record, so the person can never sign in
 * again, and that LOOKS like the end of their access. It is not. A credential stored in a collection the
 * erase registry does not list keeps working, because nothing on its path asks whether its owner still
 * exists. `supabase_connections` was the first one caught (2026-10-06): a deleted account left behind
 * encrypted tokens that could still act inside the person's own Supabase account. Its siblings were never
 * hunted, and there were four:
 *
 *   · `user_secrets` — the person's own saved API keys and database passwords (soft-deleted rows included,
 *     because the vault never destroys a stored key).
 *   · `api_keys`     — a live NavBharatAI key. `findByHash` resolves any non-revoked key to its owner and
 *     never checks that the owner exists, so the key authenticated as a uid that was gone.
 *   · `bots`         — a chat bot's token AND app secret, credentials for a third-party platform.
 *   · `webhooks`     — the outbound URLs we post the person's build events to.
 *
 * ⚠️ WHY THE CENSUS DID NOT CATCH THEM, and why this test reads SOURCE rather than trusting the registry:
 * every one of these names is a private constant or an inline literal, which
 * `tests/everyCollectionIsClassified.test.ts` cannot see (Q-701). So a registry entry agreeing with itself
 * proves nothing — the entry has to agree with the code that writes the rows. A renamed field would
 * otherwise leave an entry that queries a column no document has, and the erase would report a confident
 * `deleted: 0`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  USER_SCOPED_COLLECTIONS, RETAINED_INDEFINITELY, deleteUserData,
  type RetentionFirestore, type KeyStrategy,
} from '../src/server/lib/DataRetentionManager';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

/**
 * Each credential store, the key it is registered under, and the line of REAL source that proves that key
 * is the one the code uses. The proof is a regex over the store's own file, so a rename breaks this test
 * instead of silently breaking the erase.
 */
const CREDENTIAL_STORES: Array<{
  collection: string;
  key: KeyStrategy;
  what: string;
  source: string;
  proof: RegExp;
}> = [
  {
    collection: 'user_secrets',
    key: { field: 'user_id' },
    what: "the person's own third-party keys and database passwords",
    source: 'src/server/lib/secrets.ts',
    proof: /where\('user_id',\s*'==',\s*userId\)/,
  },
  {
    collection: 'api_keys',
    key: { field: 'userId' },
    what: 'a live NavBharatAI API key',
    source: 'src/server/lib/ApiKeyStore.ts',
    proof: /\.where\('userId',\s*'==',\s*userId\)/,
  },
  {
    collection: 'bots',
    key: { field: 'ownerUid' },
    what: "a chat bot's token and app secret",
    source: 'src/server/bots/BotStore.ts',
    proof: /\.where\('ownerUid',\s*'==',\s*ownerUid\)/,
  },
  {
    collection: 'webhooks',
    key: 'docId',
    what: 'the outbound URLs we post build events to',
    source: 'src/server/WebhookManager.ts',
    proof: /\.collection\('webhooks'\)\.doc\(userId\)/,
  },
];

// ── A Firestore just large enough to run the cascade ───────────────────────────────────────────────
type Row = Record<string, unknown>;
class TinyFirestore implements RetentionFirestore {
  private data = new Map<string, Map<string, Row>>();
  seed(collection: string, id: string, row: Row): void {
    if (!this.data.has(collection)) this.data.set(collection, new Map());
    this.data.get(collection)!.set(id, row);
  }
  /** Which documents survive, sorted — the only thing these tests assert on. */
  ids(collection: string): string[] { return [...this.col(collection).keys()].sort(); }
  private col(name: string): Map<string, Row> {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name)!;
  }
  collection(name: string) {
    const col = this.col(name);
    return {
      doc(id: string) {
        return {
          async get() { return { exists: col.has(id) }; },
          async delete() { col.delete(id); },
        };
      },
      where(field: string, op: '==' | '<', value: unknown) {
        return {
          async get() {
            const hits: string[] = [];
            // `==` is all the cascade uses; a `<` here would be a retention purge, not an erase.
            for (const [id, row] of col) if (op === '==' && row[field] === value) hits.push(id);
            return { docs: hits.map((id) => ({ ref: { async delete() { col.delete(id); } } })) };
          },
        };
      },
    };
  }
}

describe('a credential dies with the account', () => {
  it('🔒 every credential store is in the erase registry, under the key its own source proves', () => {
    for (const store of CREDENTIAL_STORES) {
      const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === store.collection);
      expect(entry, `${store.collection} (${store.what}) is in NO erase path — a deleted account keeps it`)
        .toBeTruthy();
      expect(entry!.key, `${store.collection} is registered under the wrong key`).toEqual(store.key);
    }
  });

  it('🔒 the registered key is the one the code actually uses — a rename fails here, not in production', () => {
    for (const store of CREDENTIAL_STORES) {
      const src = read(store.source);
      expect(
        store.proof.test(src),
        `${store.source} no longer matches ${String(store.proof)} — so the registry entry for `
        + `${store.collection} may now query a field no document has, and the erase would report a `
        + 'confident "deleted: 0". Re-read the store and update BOTH.',
      ).toBe(true);
    }
  });

  it('a credential is never also "retained indefinitely" — the two lists would contradict each other', () => {
    const forever = RETAINED_INDEFINITELY.map((r) => r.collection);
    for (const store of CREDENTIAL_STORES) {
      expect(forever, `${store.collection} cannot be both erased and kept for ever`).not.toContain(store.collection);
    }
  });

  it('the cascade really deletes them, and only for the account being deleted', async () => {
    const db = new TinyFirestore();
    db.seed('user_secrets', 's1', { user_id: 'victim', secret_name: 'OPENAI_API_KEY' });
    db.seed('user_secrets', 's2', { user_id: 'victim', secret_name: 'DB_PASSWORD', deleted: true });
    db.seed('user_secrets', 's3', { user_id: 'bystander', secret_name: 'OPENAI_API_KEY' });
    db.seed('api_keys', 'k1', { userId: 'victim', hash: 'h1', revoked: false });
    db.seed('api_keys', 'k2', { userId: 'bystander', hash: 'h2', revoked: false });
    db.seed('bots', 'b1', { ownerUid: 'victim', token: 't', appSecret: 'a' });
    db.seed('bots', 'b2', { ownerUid: 'bystander', token: 't', appSecret: 'a' });
    db.seed('webhooks', 'victim', { hooks: [{ url: 'https://example.invalid/hook' }] });
    db.seed('webhooks', 'bystander', { hooks: [] });

    await deleteUserData(db, 'victim');

    // 🔴 The soft-deleted row goes too: a retired vault row still holds its ciphertext.
    expect(db.ids('user_secrets')).toEqual(['s3']);
    expect(db.ids('api_keys')).toEqual(['k2']);
    expect(db.ids('bots')).toEqual(['b2']);
    expect(db.ids('webhooks')).toEqual(['bystander']);
  });

  it('the erase report names each credential store, so the person can see it happened', async () => {
    const db = new TinyFirestore();
    db.seed('api_keys', 'k1', { userId: 'victim' });
    const report = await deleteUserData(db, 'victim');
    const named = report.collections.map((c) => c.collection);
    for (const store of CREDENTIAL_STORES) expect(named).toContain(store.collection);
  });
});
