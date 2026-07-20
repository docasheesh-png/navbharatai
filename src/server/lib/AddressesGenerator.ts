// Roadmap breadth — address book / shipping-addresses starter (a packaged domain vertical).
//
// A universal vertical for ecommerce, delivery, billing and any app that ships to or bills a user. The real
// feature is the AT-MOST-ONE-DEFAULT invariant: a user can save many addresses but AT MOST ONE is the default —
// setting a new default atomically unsets the previous one, the first address a user adds becomes their default
// automatically, and deleting the default promotes another address (or leaves the user with no default). This
// emits a dependency-free AddressBook + an Express router + a README. Real logic, not a stub — the single-default
// invariant is unit-tested against the emitted code. Pure builder → the caller writes the files.

export const ADDRESS_SERVICE_SOURCE = `// Address-book domain logic. The core invariant: a user can have many addresses but AT MOST ONE default. The
// first address added becomes the default automatically; setting a new default unsets the previous one
// (atomically); deleting the default promotes the most-recently-added remaining address. In-memory here; swap
// the Map for your database, keeping the same method contracts.

export interface Address {
  id: string;
  user: string;
  name: string;        // recipient name
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export class AddressBook {
  private addresses = new Map<string, Address>();
  private seq = 0;

  private forUser(user: string): Address[] {
    const who = String(user).trim();
    return [...this.addresses.values()].filter((a) => a.user === who);
  }

  /** Clear the default flag on every OTHER address for this user (keeps the invariant of one default). */
  private clearDefaults(user: string, exceptId: string, now: string): void {
    for (const a of this.forUser(user)) {
      if (a.id !== exceptId && a.isDefault) {
        a.isDefault = false;
        a.updatedAt = now;
      }
    }
  }

  /** Add an address. The user's FIRST address becomes their default automatically. */
  add(user: string, input: AddressInput, now: Date = new Date()): Address {
    const who = String(user).trim();
    if (!who) throw new Error('user is required');
    const name = String(input?.name ?? '').trim();
    const line1 = String(input?.line1 ?? '').trim();
    const city = String(input?.city ?? '').trim();
    const postalCode = String(input?.postalCode ?? '').trim();
    const country = String(input?.country ?? '').trim();
    if (!name) throw new Error('name is required');
    if (!line1) throw new Error('line1 is required');
    if (!city) throw new Error('city is required');
    if (!postalCode) throw new Error('postalCode is required');
    if (!country) throw new Error('country is required');
    const iso = now.toISOString();
    const isFirst = this.forUser(who).length === 0;
    const address: Address = {
      id: String(++this.seq),
      user: who,
      name,
      line1,
      line2: String(input?.line2 ?? ''),
      city,
      state: String(input?.state ?? ''),
      postalCode,
      country,
      phone: String(input?.phone ?? ''),
      isDefault: isFirst, // first address is the default
      createdAt: iso,
      updatedAt: iso,
    };
    this.addresses.set(address.id, address);
    return address;
  }

  get(id: string): Address | undefined {
    return this.addresses.get(id);
  }

  private require(id: string): Address {
    const a = this.addresses.get(id);
    if (!a) throw new Error('address not found');
    return a;
  }

  /** Make an address the user's default — atomically unsets any previous default. */
  setDefault(id: string, now: Date = new Date()): Address {
    const a = this.require(id);
    const iso = now.toISOString();
    this.clearDefaults(a.user, a.id, iso);
    a.isDefault = true;
    a.updatedAt = iso;
    return a;
  }

  /** The user's current default address, if any. */
  getDefault(user: string): Address | undefined {
    return this.forUser(user).find((a) => a.isDefault);
  }

  /** Edit an address's fields (not its user or default flag — use setDefault for that). */
  update(id: string, patch: Partial<AddressInput>, now: Date = new Date()): Address {
    const a = this.require(id);
    const set = (key: keyof AddressInput, required: boolean) => {
      if (patch[key] === undefined) return;
      const v = String(patch[key]).trim();
      if (required && !v) throw new Error(key + ' cannot be empty');
      (a as unknown as Record<string, string>)[key] = v;
    };
    set('name', true); set('line1', true); set('line2', false); set('city', true);
    set('state', false); set('postalCode', true); set('country', true); set('phone', false);
    a.updatedAt = now.toISOString();
    return a;
  }

  /**
   * Remove an address. If it was the default, the most-recently-added remaining address is promoted to default
   * (so a user with any addresses always has exactly one default). Returns { removed, newDefaultId }.
   */
  remove(id: string, now: Date = new Date()): { removed: boolean; newDefaultId: string | null } {
    const a = this.addresses.get(id);
    if (!a) return { removed: false, newDefaultId: null };
    const wasDefault = a.isDefault;
    const user = a.user;
    this.addresses.delete(id);
    let newDefaultId: string | null = null;
    if (wasDefault) {
      const remaining = this.forUser(user).sort((x, y) => Number(y.id) - Number(x.id));
      if (remaining.length) {
        remaining[0].isDefault = true;
        remaining[0].updatedAt = now.toISOString();
        newDefaultId = remaining[0].id;
      }
    }
    return { removed: true, newDefaultId };
  }

  /** A user's addresses, default first then newest first. */
  list(user: string): Address[] {
    return this.forUser(user).sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return Number(b.id) - Number(a.id);
    });
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const addressBook = new AddressBook();
`;

export const ADDRESS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { addressBook } from './addressBook';

// REST endpoints for the address book. Mount with: app.use('/api', addressRouter).
export const addressRouter = Router();

// Add an address. { user, ...address }. The user's first address becomes their default automatically.
addressRouter.post('/addresses', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const address = addressBook.add(String(body.user ?? ''), {
      name: String(body.name ?? ''), line1: String(body.line1 ?? ''), line2: String(body.line2 ?? ''),
      city: String(body.city ?? ''), state: String(body.state ?? ''), postalCode: String(body.postalCode ?? ''),
      country: String(body.country ?? ''), phone: String(body.phone ?? ''),
    });
    return res.status(201).json(address);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A user's addresses (default first).
addressRouter.get('/addresses/:user', (req: Request, res: Response) => {
  return res.status(200).json(addressBook.list(req.params.user));
});

// A user's current default address.
addressRouter.get('/addresses/:user/default', (req: Request, res: Response) => {
  const a = addressBook.getDefault(req.params.user);
  if (!a) return res.status(404).json({ error: 'no default address' });
  return res.status(200).json(a);
});

// Make an address the default (unsets the previous default).
addressRouter.post('/addresses/:id/default', (req: Request, res: Response) => {
  try {
    return res.status(200).json(addressBook.setDefault(req.params.id));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'address not found' });
  }
});

// Edit an address.
addressRouter.patch('/addresses/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  for (const k of ['name', 'line1', 'line2', 'city', 'state', 'postalCode', 'country', 'phone']) {
    if (body[k] !== undefined) patch[k] = String(body[k]);
  }
  try {
    return res.status(200).json(addressBook.update(req.params.id, patch));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    return res.status(message === 'address not found' ? 404 : 400).json({ error: message });
  }
});

// Delete an address (promotes a new default if the deleted one was the default).
addressRouter.delete('/addresses/:id', (req: Request, res: Response) => {
  const result = addressBook.remove(req.params.id);
  if (!result.removed) return res.status(404).json({ error: 'address not found' });
  return res.status(200).json(result);
});
`;

const ADDRESS_README = `# Address book / shipping addresses

A real address-book backend. The core invariant: a user can save many addresses but **at most one default** —
the first address added becomes the default automatically, setting a new default **unsets the previous** one,
and deleting the default **promotes another** address (so a user with any addresses always has exactly one
default). Files:

- \`addressBook.ts\` — the domain logic (\`AddressBook\` + an \`addressBook\` singleton). In-memory; swap the Map for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { addressRouter } from './server/addresses/routes';
app.use('/api', addressRouter);
\`\`\`

Endpoints:
- \`POST /api/addresses\` \`{ user, name, line1, line2?, city, state?, postalCode, country, phone? }\` → adds (first = default).
- \`GET  /api/addresses/:user\` → the user's addresses (default first) / \`GET /api/addresses/:user/default\`.
- \`POST /api/addresses/:id/default\` → make it the default (unsets the previous).
- \`PATCH /api/addresses/:id\` → edit / \`DELETE /api/addresses/:id\` → remove (promotes a new default if needed).

Take \`user\` from the auth session in production. Pairs with the payment / listings / booking recipes.
`;

export interface AddressesConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Address book / shipping-addresses starter wired under server/addresses/ (dependency-free domain logic + an ' +
  'Express router). The real invariant is AT-MOST-ONE-DEFAULT: a user can save many addresses but at most one ' +
  'is the default — the first add() becomes the default automatically, setDefault() atomically unsets the ' +
  'previous default, and remove() of the default promotes the most-recently-added remaining address. routes.ts ' +
  'exposes POST /addresses, GET /addresses/:user (+ /default), POST /addresses/:id/default, PATCH ' +
  '/addresses/:id and DELETE /addresses/:id (returns the promoted newDefaultId). Mount with app.use("/api", ' +
  'addressRouter). Take user from the auth session in production. In-memory by default — swap the Map for your DB.';

export function generateAddressesIntegration(): AddressesConfig {
  return {
    files: {
      'server/addresses/addressBook.ts': ADDRESS_SERVICE_SOURCE,
      'server/addresses/routes.ts': ADDRESS_ROUTES_SOURCE,
      'server/addresses/README.md': ADDRESS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
