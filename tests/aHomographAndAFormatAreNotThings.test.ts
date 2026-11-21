// failedbr #1068, #1046 (2026-11-20): "zombie game banana hai" (the Hindi verb "to make") added a FRUIT hero object; "DD-MM-YYYY"
// made "YYYY" an unknown service; "a polite WhatsApp-ready text statement" made a pharmacy ledger "LARGE — clone of WhatsApp".
import { describe, expect, it } from 'vitest';
import { heroObjectContract } from '../src/server/lib/heroObjectSpec';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

const ids = (p: string) => (heroObjectContract(p) as { specs: Array<{ id: string }> }).specs.map((s) => s.id);
const clone = (p: string) => (analyzeAppScope(p) as { famousApp?: string | null }).famousApp ?? null;

describe('a homograph, a format and an output shape are not things (failedbr #1068, #1046)', () => {
  it('"banana hai" is the verb, not the fruit', () => {
    expect(ids('Mujeh ek 3D zombie game banana hai ye game offline hona chahiye')).not.toContain('fruit');
    expect(ids('monkey game that collects bananas')).toContain('fruit');
  });
  it('a date format token is not a service', () => {
    expect(unknownNamesInRequest('dates as DD-MM-YYYY and time as HH:MM')).toEqual([]);
  });
  it('"WhatsApp-ready" output is not a WhatsApp clone; a clone request still is', () => {
    expect(clone('Medical store udhaari manager. generate a polite WhatsApp-ready text statement for the customer')).toBeNull();
    expect(clone('make a whatsapp clone')).toBe('WhatsApp');
  });
});

describe('"bus" as Hinglish "bas" is not a vehicle (failedbr #898)', () => {
  it('"vah bus phone nahin …" adds no bus; a real bus still does', () => {
    expect(ids('vah bus phone nahin ghusa rahata Hai har din to ek Aisa game bnao')).not.toContain('bus');
    expect(ids('city bus driving game')).toContain('bus');
    expect(ids('bus simulator game')).toContain('bus');
  });
});
