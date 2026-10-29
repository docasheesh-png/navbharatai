import { describe,expect,it,vi } from 'vitest';
import { readLoadQuote } from './providerLoadQuote';
// Schema fields match the official /docs#price-ceiling model.supply example, not an observed live account body.
const body={object:'model.supply',model:'beam',min_discount_percent:0,list_input_per_million:'3.00',list_output_per_million:'15.00',max_input_per_million:'3.00',max_output_per_million:'15.00',candidate_count:0,primary_market_offers:null};
it('uses documented capped rate fields; absent optional inventory is not malformed',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}));
 const q=await readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic-test-only'},fetcher);
 expect(q.maximumNanoUsd).toBe(3176448000); expect(fetcher).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0][1]?.method).toBe('GET'); expect(JSON.stringify(q)).not.toContain('synthetic-test-only');
});
it.each([{max_input_per_million:undefined,list_input_per_million:undefined},{max_output_per_million:'NaN'},{model:'other'},{min_discount_percent:40}])('fails honestly when required cost evidence is absent %j',async patch=>{
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

it.each([
 [{},'quote_configuration','key_missing'],
 [{CHEAPERINFERENCE_API_KEY:'synthetic',CHEAPERINFERENCE_MODEL:'other'},'quote_configuration','model_unsupported'],
])('reports safe configuration evidence without network',async(env,stage,reason)=>{
 const f=vi.fn<typeof fetch>();await expect(readLoadQuote(256,env,f)).rejects.toMatchObject({stage,reason});expect(f).not.toHaveBeenCalled();
});
it.each(['TimeoutError','TypeError'])('classifies transport %s without exposing message',async name=>{
 const f=vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error('Bearer private'),{name}));
 await expect(readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).rejects.toMatchObject({stage:'quote_transport',reason:name==='TimeoutError'?'timeout':'network_error'});
});
it('retains allowlisted supplier status/code, never its message',async()=>{
 const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:{code:'list_price_unknown',message:'Bearer private'}}),{status:400}));
 await expect(readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).rejects.toMatchObject({stage:'quote_http',upstreamStatus:400,supplierCode:'list_price_unknown'});
});
it.each([
 ['not json','quote_schema','invalid_json'],
 [JSON.stringify({...body,model:'private model'}),'quote_schema','schema_mismatch'],
 [JSON.stringify({...body,max_output_per_million:'private'}),'quote_rates','invalid_rates'],
])('distinguishes schema/rate failures',async(raw,stage,reason)=>{
 const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(raw));await expect(readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).rejects.toMatchObject({stage,reason});
});
it.each(['TimeoutError','TypeError','AbortError'])('classifies post-header %s as transport, not malformed JSON',async name=>{
 const response=new Response('{}');vi.spyOn(response,'json').mockRejectedValue(Object.assign(Error('private credential'),{name}));
 await expect(readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toMatchObject({stage:'quote_transport',reason:name==='TimeoutError'?'timeout':'network_error',upstreamStatus:200});
});

it.each([
 {data:body},{supply:body},[body],{...body,model:'beam-1.0-501b-a23b'},{...body,min_discount_percent:'0'},{...body,object:undefined},{...body,max_input_per_million:3,max_output_per_million:15},
])('tolerates valid supplier 200 variants %j',async variant=>{
 const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(variant)));
 await expect(readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).resolves.toMatchObject({maximumNanoUsd:3176448000});
});
it('all-null 200 body still fails honestly with field evidence',async()=>{
 const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({object:null,model:null})));
 await expect(readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).rejects.toMatchObject({code:'unavailable'});
});

describe('alternate supplier rate fields', () => {
 const base={object:'model.supply',model:'beam',min_discount_percent:null,max_input_per_million:null,max_output_per_million:null};
 it.each([
  {...base,list_input_per_million:'3.00',list_output_per_million:'15.00'},
  {...base,pricing:{input:'3.00',output:'15.00'}},
  {...base,price_ceiling:{max_input_per_million:3,max_output_per_million:15}},
  {...base,rates:{prompt:'3',completion:'15'}},
  {...base,primary_market_offers:[{input_per_million:'1'},{input_per_million:'3',output_per_million:'15'}]},
  {data:{...base,list_input_per_million:'3',list_output_per_million:'15'}},
 ])('accepts %j', async b => {
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(b)));
  await expect(readLoadQuote(2048,{CHEAPERINFERENCE_API_KEY:'synthetic'},f)).resolves.toMatchObject({maximumNanoUsd:3176448000});
 });
 it('reports key names (never values) when rates truly absent', async () => {
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...base,candidate_count:0,secret_price:{x:1}})));
  const e=await readLoadQuote(256,{CHEAPERINFERENCE_API_KEY:'synthetic'},f).catch(x=>x);
  expect(e).toMatchObject({stage:'quote_rates',reason:'invalid_rates'});
  expect(e.keys).toEqual(expect.arrayContaining(['object','model','max_input_per_million','candidate_count','secret_price.x']));
  expect(JSON.stringify(e.keys)).not.toContain('beam');
 });
});

import { readLoadQuote as rq } from './providerLoadQuote';
import { it as it2, expect as ex2 } from 'vitest';
it2('falls back to /v1/models catalog pricing when supply 200 has all-null rates', async () => {
  const env = { CHEAPERINFERENCE_API_KEY: 'ci_live_x', CHEAPERINFERENCE_MODEL: 'beam' } as unknown as NodeJS.ProcessEnv;
  const t = (async (url: string) => String(url).includes('/models/supply')
    ? new Response(JSON.stringify({ object: 'model.supply', model: 'beam', min_discount_percent: 0, list_input_per_million: null, list_output_per_million: null, max_input_per_million: null, max_output_per_million: null, candidate_count: 2 }), { status: 200 })
    : new Response(JSON.stringify({ object: 'list', data: [{ id: 'other' }, { id: 'beam', pricing: { input_per_million: '0.20', output_per_million: '0.80' } }] }), { status: 200 })) as unknown as typeof fetch;
  const q = await rq(64, env, t);
  ex2(q.maximumNanoUsd).toBeGreaterThan(0);
});
