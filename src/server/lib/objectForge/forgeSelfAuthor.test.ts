// SELF-AUTHORING: a description in, a checked object out, with the model shown the Forge's own drawing between rounds. The model is a
// script here (a function that answers what a model would), so every rule is tested without one: the loop, the feedback it carries, the
// stop conditions, the honest failures.
import { describe, it, expect, beforeEach } from 'vitest';
import { selfAuthorObject, warningScore, parseSpecText, objectIdFor, madeCache, SELF_AUTHOR_ROUNDS, SELF_AUTHOR_SYSTEM } from './forgeSelfAuthor';

const good = (extra: Record<string, unknown> = {}) => ({
  id: 'whatever-the-model-chose', name: 'Lighthouse',
  materials: { stone: { color: '#d9d4c7' }, lamp: { color: '#ffe9a8', emissive: '#ffd45e' } },
  nodes: [
    { name: 'tower', shape: { type: 'cylinder', radiusTop: 1.5, radiusBottom: 2.5, height: 12, seg: 14 }, material: 'stone', position: [0, 6, 0] },
    { name: 'lamp_room', shape: { type: 'cylinder', radiusTop: 1.6, radiusBottom: 1.6, height: 1.6, seg: 14 }, material: 'lamp', position: [0, 12.8, 0] },
    { name: 'cap', shape: { type: 'cylinder', radiusTop: 0, radiusBottom: 2.1, height: 1.2, seg: 14 }, material: 'stone', position: [0, 14.2, 0] },
  ],
  ...extra,
});
const floating = () => good({ nodes: [...good().nodes, { name: 'seagull', shape: { type: 'sphere', radius: 0.4 }, material: 'stone', position: [0, 20, 0] }] });

/** A model that gives the next scripted answer each time it is asked, and remembers what it was asked. */
function scripted(answers: Array<string | null | (() => string)>) {
  const calls: Array<{ prompt: string; system: string }> = [];
  return {
    calls,
    ask: async (prompt: string, system: string) => {
      calls.push({ prompt, system });
      const a = answers[Math.min(calls.length - 1, answers.length - 1)];
      return typeof a === 'function' ? a() : a;
    },
  };
}
const j = (v: unknown) => JSON.stringify(v);

beforeEach(() => madeCache.clear());

describe('the loop', () => {
  it('a clean first answer is accepted at once: one model call, no warnings, the id is ours', async () => {
    const m = scripted([j(good())]);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(r.ok).toBe(true);
    expect(m.calls.length).toBe(1);
    expect(r.remainingWarnings).toEqual([]);
    expect(r.spec!.id).toBe(objectIdFor('a lighthouse'));
    expect(r.report!.size[1]).toBeGreaterThan(14);
  });

  it('shows the model its OWN drawing and the warning, and takes the corrected spec', async () => {
    const m = scripted([j(floating()), j(good())]);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(m.calls.length).toBe(2);
    const second = m.calls[1].prompt;
    expect(second).toMatch(/float free of the main body: \[seagull\]/);
    expect(second).toContain('FRONT'); expect(second).toContain('SIDE'); expect(second).toContain('TOP');
    expect(second).toContain('"seagull"'); // its previous spec comes back so it can correct it, not start over
    expect(r.ok).toBe(true);
    expect(r.remainingWarnings).toEqual([]);
    expect(r.attempts.map((a) => a.warnings.length)).toEqual([1, 0]);
  });

  it('feeds validation errors back with the exact reasons', async () => {
    const bad = good(); (bad.nodes[0] as any).shape = { type: 'pyramid' };
    const m = scripted([j(bad), j(good())]);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(m.calls[1].prompt).toMatch(/one of: box, sphere/);
    expect(r.ok).toBe(true);
  });

  it('survives a reply that is prose or broken JSON, and asks again', async () => {
    const m = scripted(['Sure! Here is a lighthouse. It is tall.', '{"id": "x", "nodes": [', 'Here you go:\n```json\n' + j(good()) + '\n```']);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(r.ok).toBe(true);
    expect(m.calls.length).toBe(3);
    expect(m.calls[1].prompt).toMatch(/not valid JSON/);
  });

  it('stops at the round limit and returns the BEST valid result, with its warnings stated', async () => {
    const two = floating(); (two.nodes as any[]).push({ name: 'kite', shape: { type: 'sphere', radius: 0.3 }, material: 'lamp', position: [0, 25, 0] });
    const m = scripted([j(two), j(floating()), j(two), j(two), j(good())]);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(m.calls.length).toBe(SELF_AUTHOR_ROUNDS);
    expect(r.ok).toBe(true);
    expect(r.remainingWarnings.length).toBeGreaterThan(0);
    // The best of the four had ONE floating group (the second answer), not two.
    expect(r.remainingWarnings.join(' ')).toMatch(/1 group\(s\) of parts float free/);
    expect(r.attempts.length).toBe(4);
  });

  it('honours a smaller round limit, and never exceeds the cap however large one is asked for', async () => {
    const m1 = scripted([j(floating())]);
    await selfAuthorObject('x thing', { ask: m1.ask, rounds: 1 });
    expect(m1.calls.length).toBe(1);
    const m2 = scripted([j(floating())]);
    await selfAuthorObject('x thing', { ask: m2.ask, rounds: 99 });
    expect(m2.calls.length).toBe(SELF_AUTHOR_ROUNDS);
  });
});

describe('it fails honestly and never throws', () => {
  it('a model that never answers: not ok, no spec, one attempt, a way forward', async () => {
    const m = scripted([null]);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(r.ok).toBe(false);
    expect(r.spec).toBeUndefined();
    expect(r.text).toMatch(/could not make "a lighthouse"/); expect(r.text).toMatch(/author_object\(\{ spec \}\)/);
  });

  it('a model call that throws is the same as no answer', async () => {
    const r = await selfAuthorObject('a lighthouse', { ask: async () => { throw new Error('boom'); } });
    expect(r.ok).toBe(false);
  });

  it('answers that are never valid end in failure naming the last problem', async () => {
    const m = scripted(['nonsense']);
    const r = await selfAuthorObject('a lighthouse', { ask: m.ask });
    expect(r.ok).toBe(false);
    expect(m.calls.length).toBe(SELF_AUTHOR_ROUNDS);
    expect(r.text).toMatch(/not a JSON object/);
  });

  it('an empty description is refused before any model call', async () => {
    const m = scripted([j(good())]);
    const r = await selfAuthorObject('  ', { ask: m.ask });
    expect(r.ok).toBe(false);
    expect(m.calls.length).toBe(0);
  });
});

describe('what the model is told', () => {
  it('the first prompt carries the request, the real-world facts when there are any, and a worked example', async () => {
    const m = scripted([j(good())]);
    await selfAuthorObject('a lighthouse', { ask: m.ask, groundTruth: 'Lighthouse: 20 m tall, tower base 6 m wide.' });
    const p = m.calls[0].prompt;
    expect(p).toContain('"a lighthouse"'); expect(p).toContain('20 m tall'); expect(p).toContain('"id":"house"'); expect(p).toContain('WHAT A BUILDING MUST HAVE');
    expect(p).toContain('"id": "' + objectIdFor('a lighthouse') + '"');
  });

  it('the system prompt teaches the grammar and the conventions, and says to answer with JSON only', () => {
    expect(SELF_AUTHOR_SYSTEM).toMatch(/ONLY one JSON object/);
    expect(SELF_AUTHOR_SYSTEM).toMatch(/FACES \+Z/);
    expect(SELF_AUTHOR_SYSTEM).toMatch(/loft/);
    expect(SELF_AUTHOR_SYSTEM).not.toMatch(/author_object/); // the modeller is not the builder: it does not call tools
  });
});

describe('helpers', () => {
  it('warningScore ranks two detached groups worse than one, and any warning worse than none', () => {
    expect(warningScore([])).toBe(0);
    expect(warningScore(['1 group(s) of parts float free of the main body: [a]'])).toBeLessThan(warningScore(['2 group(s) of parts float free of the main body: [a] [b]']));
    expect(warningScore(['2 group(s) of parts float free of the main body: [a] [b]'])).toBeLessThan(warningScore(['x', 'y']));
  });

  it('parseSpecText takes the outermost object from a fence or a sentence, and nothing else', () => {
    expect(parseSpecText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseSpecText('here: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    for (const bad of [null, undefined, '', 'no braces', '[1,2]', '{broken', '{"a":1} {"b":2}']) expect(parseSpecText(bad as string)).toBeNull();
  });

  it('objectIdFor preserves full Unicode identity with stable NFC equivalence', () => {
    for (const w of ['9 lives', '!!!', 'ऊँट', 'x'.repeat(200)]) expect(objectIdFor(w)).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
    expect(objectIdFor(' café ')).toBe(objectIdFor('cafe\u0301'));
    expect(objectIdFor('ऊँट')).not.toBe(objectIdFor('हाथी'));
    expect(objectIdFor('x'.repeat(300) + 'red')).not.toBe(objectIdFor('x'.repeat(300) + 'blue'));
    expect(objectIdFor('A Lighthouse')).not.toBe(objectIdFor('a lighthouse'));
  });

  it('the cache requires project and object identity, clones values, and is bounded', () => {
    const spec = { id: 'lamp', nested: { color: 'red' } };
    madeCache.set('a lamp', spec);
    expect(madeCache.get('a lamp')).toBeUndefined();
    expect(madeCache.size()).toBe(0);
    madeCache.set(' café ', spec, 'project-a', 'lamp');
    spec.nested.color = 'blue';
    const got = madeCache.get('cafe\u0301', 'project-a', 'lamp')!;
    expect(got).toEqual({ id: 'lamp', nested: { color: 'red' } });
    (got.nested as { color: string }).color = 'green';
    expect(madeCache.get('café', 'project-a', 'lamp')).toEqual({ id: 'lamp', nested: { color: 'red' } });
    expect(madeCache.get('café', 'project-b', 'lamp')).toBeUndefined();
    expect(madeCache.get('café', 'project-a', 'other')).toBeUndefined();
    expect(madeCache.get('café', 'project-a')).toBeUndefined();
    for (let i = 0; i < 300; i++) madeCache.set('thing ' + i, { id: 'x' }, 'project-a', 'x');
    expect(madeCache.size()).toBeLessThanOrEqual(200);
  });
});
