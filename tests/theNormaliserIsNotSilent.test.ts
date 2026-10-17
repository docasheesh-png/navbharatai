// THE ENUM NORMALISER IS NOT SILENT (Q-1027, found reviewing Q-984).
//
// 🔴 THE ROW SAID "silent in the report". MEASURED, IT WAS WORSE: `prepareSharedContract` computed
// `enumsAsConst` — the list of enums it had just rewritten as `as const` objects — returned it, and **NOTHING
// IN THE REPO READ IT.** Not the report, not the hand-off, not the contract's own header, not the blueprint
// block. Four greps, one answer: the field had no reader at all.
//
//     $ grep -rn "enumsAsConst" --include=*.ts . | grep -v tests
//     SimpleBuilder.ts:1396:  enumsAsConst: string[];      ← declared
//     SimpleBuilder.ts:1419:  let enumsAsConst …           ← assigned
//     SimpleBuilder.ts:1434:  enumsAsConst = normalised…   ← assigned
//     SimpleBuilder.ts:1437:  return { contract, renamed, enumsAsConst };   ← returned, and that is all
//
// 🧬 THE CLASS: **a measurement computed and returned with no reader is indistinguishable from one never
// computed.** The same shape as Q-1011, where `endgameBatchRepair` left no `llmCalls` row and the one place
// a reader would look was empty. So the rewrite happened, correctly, and the next autopsy could not see it
// fire — the exact thing this row was raised for.
//
// 🔑 AND IT IS NOT ONLY BOOKKEEPING, which is why an "info line" alone would not have been enough.
// `contractEnums.ts` names a residual it cannot reach: a CONSUMER that writes a member as a TYPE —
// `interface AddAction { type: ActionType.Add }` — gets **TS2702** against an `as const` object, because the
// name no longer refers to a type. The model is only told that if someone tells it. So the fact now travels
// the SAME four roads a rename travels (Q-985's pattern): the contract file's header, the user-facing log,
// the hand-off to the full builder, and the blueprint block.
//
// ⚠️ THE BLUEPRINT LANE IS THE SIBLING THE ROW NEVER MENTIONED. `blueprintAdvisoryBlock` already named a
// rename and said nothing about a normalised enum — while showing the architect a contract that had ALREADY
// been rewritten. It read `as const` objects with nothing to say why.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { stringEnumsAsConstObjects, contractEnumHeaderLine, contractEnumsSentence } from '../src/server/AgentV3/contractEnums';
import { prepareSharedContract, contractModule, blueprintAdvisoryBlock } from '../src/server/AgentV3/SimpleBuilder';
import { contractEnumHandoffClause } from '../src/server/AgentV3/handoffRule';

const root = join(__dirname, '..');
/** The real failure's contract (build 9c612cdb): a string enum an isolated consumer cannot satisfy. */
const CONTRACT = `export enum VideoSource { YouTube = 'YouTube', Vimeo = 'Vimeo' }
export interface Video { id: string; source: VideoSource }
`;
const MANIFEST = [{ path: 'src/components/VideoList.tsx', purpose: 'the list' }] as never;

describe('🔴 the rewrite happens, and now it is SAID', () => {
  const prepared = prepareSharedContract(CONTRACT, MANIFEST);

  it('the enum really is rewritten — the fix itself is untouched', () => {
    expect(prepared.contract).toContain('as const');
    expect(prepared.contract).not.toMatch(/export enum VideoSource/);
    expect(prepared.enumsAsConst).toEqual(['VideoSource']);
  });

  it('🔑 the contract FILE names it — the file the hand-off says to read first', () => {
    const mod = contractModule(prepared.contract, prepared.renamed, prepared.enumsAsConst);
    expect(mod, 'the contract must still build as a module').not.toBeNull();
    expect(mod!.source).toContain('as-const: VideoSource');
    expect(mod!.source, 'and the TS2702 residual is named, not left to be discovered')
      .toContain('typeof VideoSource.Member');
  });

  it('…and says nothing when nothing was converted', () => {
    const plain = prepareSharedContract('export interface Video { id: string }\n', MANIFEST);
    expect(plain.enumsAsConst).toEqual([]);
    const mod = contractModule(plain.contract, [], []);
    expect(mod!.source).not.toContain('as-const:');
  });

  it('🔑 the HAND-OFF names it — the full builder never saw the contract call', () => {
    expect(contractEnumHandoffClause(['VideoSource'])).toContain('VideoSource');
    expect(contractEnumHandoffClause(['VideoSource'])).toMatch(/^ /);
    expect(contractEnumHandoffClause(['VideoSource'])).toContain('typeof Name.Member');
    expect(contractEnumHandoffClause([]), 'and is empty when there is nothing to say').toBe('');
    expect(contractEnumHandoffClause(undefined)).toBe('');
  });

  it('🔑 the BLUEPRINT block names it — the sibling the row never mentioned', () => {
    // ⚠️ MY FIRST TWO ASSERTIONS HERE PASSED FOR THE WRONG REASON, and a reversion caught it: I checked for
    // 'as const' and 'VideoSource', and BOTH are in the contract source this block embeds — so they held
    // even with the sentence deleted. A test that cannot fail proves nothing. The whole sentence it must
    // carry is asserted instead, which only the push can satisfy.
    const sentence = contractEnumsSentence(prepared.enumsAsConst);
    expect(sentence).not.toBe('');
    const withEnums = blueprintAdvisoryBlock(MANIFEST, prepared.contract, prepared.renamed, prepared.enumsAsConst);
    expect(withEnums).toContain(sentence);
    const without = blueprintAdvisoryBlock(MANIFEST, prepared.contract, prepared.renamed, []);
    expect(without, 'the architect used to read the rewritten contract with nothing to say why')
      .not.toContain(sentence);
  });

  it('the sentence is one wording, read by every road', () => {
    const one = contractEnumsSentence(['A']);
    expect(one).toContain('the enum A');
    expect(contractEnumsSentence(['A', 'B'])).toContain('the enums A, B');
    expect(contractEnumsSentence([])).toBe('');
    expect(contractEnumsSentence(['  '] as string[]), 'blank names are not names').toBe('');
  });
});

describe('🧭 CLASS GUARD: the field has readers now, and the wording has one home', () => {
  const read = (p: string) => stripCodeComments(readFileSync(join(root, p), 'utf8'));

  it('🔴 `enumsAsConst` is no longer write-only', () => {
    // The census that would have caught this when the field was first added: a value that is only ever
    // declared, assigned and returned has no reader, and a fact nobody reads was never recorded.
    const sb = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(sb, 'the contract file receives it').toMatch(/contractModule\(contract, contractRenames, contractEnumsAsConst\)/);
    expect(sb, 'the build narrates it').toMatch(/Rewrote \$\{prepared\.enumsAsConst\.join/);
    expect(sb, 'the result carries it out').toMatch(/contractEnumsAsConst \} :/);
    expect(sb, 'the header renders one line per converted enum').toMatch(/enumsAsConst\.map\(contractEnumHeaderLine\)/);
    const route = read('src/server/routes/agentv3.ts');
    expect(route, 'the hand-off names it').toContain('contractEnumHandoffClause(sb.contractEnumsAsConst)');
    expect(route, 'the blueprint lane passes it').toContain('prepared.enumsAsConst)');
  });

  it('the hand-off clause is called ONCE, not inlined twice', () => {
    // My first draft inlined `contractEnumsSentence(...)` twice in the route's concatenation — once to test
    // it, once to use it — which is the duplication Q-1026/Q-1033 exist to stop. One clause helper instead.
    const route = read('src/server/routes/agentv3.ts');
    expect([...route.matchAll(/contractEnumHandoffClause\(/g)].length).toBe(1);
    expect(route, 'and the sentence itself is not spelled out in the route').not.toContain('contractEnumsSentence(');
  });

  it('the wording lives in contractEnums.ts and nowhere else', () => {
    // 🔁 READ RAW HERE, NOT STRIPPED — and the reason is funny enough to write down. `contractEnumHeaderLine`
    // returns a string that BEGINS with `//`, because the line it produces is a comment in the generated
    // contract file. So `stripCodeComments` treats that string literal as a comment and eats the sentence,
    // and this assertion failed on its own subject. A copy of the wording anywhere — code or comment — is a
    // copy, so raw is also the right question to ask.
    const raw = (p: string) => readFileSync(join(root, p), 'utf8');
    for (const f of ['src/server/AgentV3/SimpleBuilder.ts', 'src/server/routes/agentv3.ts',
      'src/server/AgentV3/handoffRule.ts']) {
      expect(raw(f), `${f} must not spell the sentence out`).not.toContain('with a value-union type, not an enum');
    }
    expect(raw('src/server/AgentV3/contractEnums.ts')).toContain('value-union type, not an enum');
  });

  it('PRECISION: an enum the normaliser leaves alone is never announced', () => {
    // Explicit numeric values are deliberately NOT converted (their runtime values would change), so
    // there is nothing to say about them — and saying it anyway would be a false claim.
    const numeric = 'export enum Dir { LEFT = -1, RIGHT = 1 }\n';
    const out = stringEnumsAsConstObjects(numeric);
    expect(out.converted).toEqual([]);
    expect(out.contract).toBe(numeric);
    expect(contractEnumsSentence(out.converted)).toBe('');
  });

  it('the header line is a reader-facing comment, and says so', () => {
    expect(contractEnumHeaderLine('X')).toMatch(/^\/\/ as-const: X /);
    expect(contractEnumHeaderLine('X')).toContain('typeof X.Member');
  });
});
