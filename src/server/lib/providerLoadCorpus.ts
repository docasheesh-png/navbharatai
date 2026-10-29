import type { LoadQuestion } from './providerLoadBatch';
/** Public synthetic tasks only. Stable prefix allows count edits without replacing past questions. */
export function providerLoadCorpus(count: number): LoadQuestion[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Invalid corpus count');
  return Array.from({ length: count }, (_, ordinal) => {
    const n = ordinal + 10001, a = n * 13 + 7, b = n * 3 + 11;
    let task: string, expected: unknown;
    switch (ordinal % 6) {
      case 0: task = `Compute ${a} + ${b} * 7.`; expected = a + b * 7; break;
      case 1: task = `Sort these integers in ascending order: [${b},${-a},${n},${a}].`; expected = [-a, n, b, a]; break;
      case 2: task = `Reverse the string "harbor${n}ledger${a}".`; expected = `harbor${n}ledger${a}`.split('').reverse().join(''); break;
      case 3: task = `Return the remainder of ${a} squared divided by ${b}.`; expected = Number(BigInt(a) ** 2n % BigInt(b)); break;
      case 4: task = `Return the sum of even numbers in [${n},${n + 1},${n + 2},${n + 3}].`; expected = [n,n+1,n+2,n+3].filter(x => x % 2 === 0).reduce((x,y) => x+y,0); break;
      default: task = `The records are [{"name":"A","value":${a}},{"name":"B","value":${b}}]. Return the name with the larger value.`; expected = 'A';
    }
    return { id: `synthetic-v1-${ordinal}`, prompt: `${task} Return only the answer as valid JSON, without explanation or code fences.`, expected };
  });
}
