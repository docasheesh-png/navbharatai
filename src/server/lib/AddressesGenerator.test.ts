import { describe, it, expect, afterAll } from 'vitest';

import { generateAddressesIntegration, ADDRESS_SERVICE_SOURCE } from './AddressesGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateAddressesIntegration (wiring)', () => {
  it('emits the address book, routes and README', () => {
    const out = generateAddressesIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/addresses/addressBook.ts');
    expect(paths).toContain('server/addresses/routes.ts');
    expect(paths).toContain('server/addresses/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/addresses/routes.ts']).toContain('export const addressRouter');
  });
});

// Materialize + execute the emitted domain logic — the at-most-one-default invariant is a real business rule,
// verified against the actual emitted code.
describe('emitted AddressBook — at-most-one-default invariant (real logic)', () => {
  const emitted = emitModule('address', ADDRESS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Address { id: string; user: string; isDefault: boolean; name: string; city: string }
  interface Service {
    add(user: string, input: { name: string; line1: string; line2?: string; city: string; state?: string; postalCode: string; country: string; phone?: string }, now?: Date): Address;
    get(id: string): Address | undefined;
    setDefault(id: string, now?: Date): Address;
    getDefault(user: string): Address | undefined;
    update(id: string, patch: Record<string, string>, now?: Date): Address;
    remove(id: string, now?: Date): { removed: boolean; newDefaultId: string | null };
    list(user: string): Address[];
  }
  interface Emitted { AddressBook: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  const A = (over: Partial<{ name: string; line1: string; city: string; postalCode: string; country: string }> = {}) => ({
    name: 'Asha', line1: '1 MG Road', city: 'Pune', postalCode: '411001', country: 'IN', ...over,
  });

  it('the first address a user adds becomes their default automatically', async () => {
    const { AddressBook } = await load();
    const svc = new AddressBook();
    const a = svc.add('u1', A());
    expect(a.isDefault).toBe(true);
    expect(svc.getDefault('u1')?.id).toBe(a.id);
    // a second address is NOT default by default
    const b = svc.add('u1', A({ name: 'Work' }));
    expect(b.isDefault).toBe(false);
    expect(svc.getDefault('u1')?.id).toBe(a.id);
  });

  it('setDefault atomically unsets the previous default — never two defaults', async () => {
    const { AddressBook } = await load();
    const svc = new AddressBook();
    const a = svc.add('u1', A());
    const b = svc.add('u1', A({ name: 'Work' }));
    svc.setDefault(b.id);
    expect(svc.get(a.id)?.isDefault).toBe(false);
    expect(svc.get(b.id)?.isDefault).toBe(true);
    // exactly one default across the user's addresses
    expect(svc.list('u1').filter((x) => x.isDefault).length).toBe(1);
  });

  it('deleting the default promotes the most-recently-added remaining address', async () => {
    const { AddressBook } = await load();
    const svc = new AddressBook();
    const a = svc.add('u1', A());               // default
    svc.add('u1', A({ name: 'B' }));            // b
    const c = svc.add('u1', A({ name: 'C' }));  // c (newest)
    // remove the default → newest remaining (c) is promoted
    const res = svc.remove(a.id);
    expect(res).toMatchObject({ removed: true, newDefaultId: c.id });
    expect(svc.getDefault('u1')?.id).toBe(c.id);
    expect(svc.list('u1').filter((x) => x.isDefault).length).toBe(1);
  });

  it('deleting a NON-default address leaves the default untouched; last delete leaves no default', async () => {
    const { AddressBook } = await load();
    const svc = new AddressBook();
    const a = svc.add('u1', A());       // default
    const b = svc.add('u1', A({ name: 'B' }));
    expect(svc.remove(b.id).newDefaultId).toBeNull(); // b wasn't default → nothing promoted
    expect(svc.getDefault('u1')?.id).toBe(a.id);
    // removing the last (default) address leaves the user with no default
    expect(svc.remove(a.id)).toMatchObject({ removed: true, newDefaultId: null });
    expect(svc.getDefault('u1')).toBeUndefined();
    // remove of a missing id is a no-op
    expect(svc.remove('nope').removed).toBe(false);
  });

  it('defaults are per-user and required fields are validated', async () => {
    const { AddressBook } = await load();
    const svc = new AddressBook();
    const a1 = svc.add('u1', A());
    const a2 = svc.add('u2', A());
    // each user has their own default
    expect(a1.isDefault).toBe(true);
    expect(a2.isDefault).toBe(true);
    expect(svc.getDefault('u1')?.id).toBe(a1.id);
    expect(svc.getDefault('u2')?.id).toBe(a2.id);
    expect(() => svc.add('', A())).toThrow(/user is required/);
    expect(() => svc.add('u1', A({ line1: '' }))).toThrow(/line1 is required/);
    expect(() => svc.add('u1', A({ postalCode: '' }))).toThrow(/postalCode is required/);
  });
});
