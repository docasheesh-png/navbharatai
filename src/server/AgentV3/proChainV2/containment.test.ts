import { it, expect } from 'vitest';
import { proChainV2Decision } from './policy';
it('keeps all activation modes on the original production route', () => {
  for (const env of [{}, {PRO_CHAIN_V2:'on'}, {PRO_CHAIN_V2:'on',PRO_CHAIN_V2_PUBLIC:'on'}, {PRO_CHAIN_V2:'on',PRO_CHAIN_V2_USERS:'z@gmail.com,uid'}]) {
    for (const [email,uid] of [['z@gmail.com','uid'],['another@example.com','other']]) {
      expect(proChainV2Decision('weak',email,uid,env)).toEqual({enabled:false,reason:'admission-unavailable'});
    }
  }
  expect(proChainV2Decision('weak','z@gmail.com','uid',{PRO_CHAIN_V2:'off'})).toEqual({enabled:false,reason:'kill-switch'});
  expect(proChainV2Decision('mini','z@gmail.com','uid',{PRO_CHAIN_V2:'on'})).toEqual({enabled:false,reason:'not-weak'});
});
