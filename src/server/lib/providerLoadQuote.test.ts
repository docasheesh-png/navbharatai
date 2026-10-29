import { expect,it,vi } from 'vitest';
import { readLoadQuote } from './providerLoadQuote';
// Schema fields match the official /docs#price-ceiling model.supply example, not an observed live account body.
const body={object:'model.supply',model:'beam',min_discount_percent:0,list_input_per_million:'3.00',list_output_per_million:'15.00',max_input_per_million:'3.00',max_output_per_million:'15.00',candidate_count:0,primary_market_offers:null};
it('uses documented capped rate fields; absent optional inventory is not malformed',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}));
 const q=await readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic-test-only'},fetcher);
 expect(q.maximumNanoUsd).toBe(3176448000); expect(fetcher).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0][1]?.method).toBe('GET'); expect(JSON.stringify(q)).not.toContain('synthetic-test-only');
});
it.each([{max_input_per_million:undefined},{max_output_per_million:'NaN'},{model:'other'},{min_discount_percent:40}])('fails honestly when required cost evidence is absent %j',async patch=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...body,...patch})));
 await expect(readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic-test-only'},fetcher)).rejects.toMatchObject({code:'unavailable'});
});
it('never exposes raw supplier error bodies or retries the quote',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('secret credentials',{status:503}));
 await expect(readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic-test-only'},fetcher)).rejects.toThrow('Batch unavailable');
 expect(fetcher).toHaveBeenCalledOnce();
});

it('reservation follows the exact requested native output limit',async()=>{
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(body)));
 const env={CHEAPERINFERENCE_API_KEY:'synthetic-only'};
 const small=await readLoadQuote(2048,env,transport),large=await readLoadQuote(4096,env,transport);
 expect(large.maximumNanoUsd-small.maximumNanoUsd).toBe(30720000);
 await expect(readLoadQuote(0,env,transport)).rejects.toMatchObject({code:'invalid'});
});
