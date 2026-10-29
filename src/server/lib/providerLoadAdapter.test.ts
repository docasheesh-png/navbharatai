import {expect,it,vi} from 'vitest';
import {providerLoadAdapter} from './providerLoadAdapter';
import type {LoadBatchAuthority} from './providerLoadBatch';
it('binds the native quoted ceiling and output setting on exactly one configured provider request',async()=>{
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({choices:[{message:{content:'1'},finish_reason:'stop'}],billing:{status:'settled',currency:'USD',billed_cost_usd:'0.000001'}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',transport);
 try {const a=providerLoadAdapter({model:'beam',maxOutputTokens:512} as LoadBatchAuthority,{CHEAPERINFERENCE_API_KEY:'synthetic-only'});await a.call('Return JSON 1',new AbortController().signal);
 expect(transport).toHaveBeenCalledOnce();expect(String(transport.mock.calls[0][0])).toBe('https://api.cheaperinference.com/v1/chat/completions');expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({model:'beam',stream:false,max_tokens:512,min_discount_percent:0});}
 finally{vi.unstubAllGlobals();}
});
