import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSignals, runDmarketCollectionDiagnostic as run } from '../scripts/check-dmarket-collection.mjs';
import { P0_CELLS, observeP0Identity } from '../backend/dmarket-p0.mjs';
const env = { DMARKET_PUBLIC_KEY: 'a'.repeat(64), DMARKET_SECRET_KEY: 'b'.repeat(64) };
const opts = { env, pause: async () => {} };
const cell = P0_CELLS.find(c => c.collection_id === 'mirage-2021'), item = cell.items[0];
const expected = cell.source_collection;
const row = (collection = expected, name = item.base_name) => ({ offerId: 'PRIVATE-ID', priceCents: '123',
  attributes: { name, title: 'PRIVATE_TITLE', cs2: { collection, category: 'CATEGORY_NORMAL', quality: 'PRIVATE_QUALITY', float: '0.075' } } });

test('categories have deterministic precedence and safe flags', () => {
  const canonical = 'the 2021 mirage collection';
  for (const [value, category, flags] of [
    [canonical,'EXACT',[true,true,true,true,true]],
    [canonical.toUpperCase(),'CASE',[false,true,false,true,true]],
    [` ${canonical} `,'TRIM',[false,false,true,true,true]],
    ['THE-2021-MIRAGE-COLLECTION','NORMALIZED',[false,false,false,true,true]],
    ['Mirage 2021','TOKEN_EQUIVALENT',[false,false,false,false,true]],
    ['PRIVATE_COLLECTION','DIFFERENT',[false,false,false,false,false]]
  ]) {
    const s = collectionSignals(value,canonical);
    assert.equal(s.collection_component,category);
    assert.deepEqual(Object.values(s).slice(0,5),flags);
    assert.equal(s.collection_length,value.length);
    assert.ok(!JSON.stringify(s).includes(value));
  }
  for (const value of [null,undefined,{},123,[], 'mirage 2021 extra', 'mirage 2021 2021', 'mirage 20210']) {
    assert.equal(collectionSignals(value,canonical).collection_component,'DIFFERENT');
  }
  assert.equal(collectionSignals({},canonical).collection_length,null);
});

test('two exact read-only requests, five rows, safe report and aggregation; no pagination', async () => {
  const titles = [], pauses = [];
  const report = await run({...opts,pause:async ms => pauses.push(ms),fetcher:async (url,options) => {
    titles.push(url.searchParams.get('title'));
    assert.equal(url.origin,'https://api.dmarket.com');
    assert.equal(url.pathname,'/marketplace-api/v2/offers');
    assert.deepEqual([...url.searchParams.keys()],['gameId','title','limit']);
    assert.equal(url.searchParams.get('gameId'),'a8db'); assert.equal(url.searchParams.get('limit'),'5');
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.match(options.headers['X-Request-Sign'],/^dmar ed25519 [a-f0-9]{128}$/);
    return Response.json({items:Array.from({length:5},()=>row('PRIVATE_COLLECTION',url.searchParams.get('title'))),cursor:'PRIVATE_CURSOR',private:'PRIVATE_PAYLOAD'});
  }});
  assert.deepEqual(titles,['MAC-10 | Sienna Damask','P90 | Verdant Growth']);
  assert.deepEqual(pauses,[1100]); assert.equal(report.calls,2); assert.equal(report.status,'READ_COMPLETE');
  assert.equal(report.production_activated,false); assert.equal(report.planner_exercised,false); assert.equal(report.economic_authority,'DMARKET_ONLY');
  assert.deepEqual(report.limits,{requests:2,rows_per_request:5,response_bytes:1048576,wall_seconds:30});
  for (const c of report.cells) {
    const r=c.requests[0]; assert.equal(c.requests.length,1); assert.equal(r.variant,'NORMAL');
    assert.equal(r.collection_signals.length,5); assert.equal(r.component_counts.DIFFERENT,5);
    assert.equal(r.all_five_rows_same_safe_pattern,true); assert.equal(r.strict_identity_pass_count,0);
    assert.deepEqual(r.rejections,{DMARKET_P0_COLLECTION:5});
  }
  const json=JSON.stringify(report);
  for (const forbidden of ['PRIVATE',expected,...titles,env.DMARKET_SECRET_KEY,env.DMARKET_PUBLIC_KEY]) assert.ok(!json.includes(forbidden));
  // CLI emits this exact JSON; there are no per-row logging paths.
});

test('mixed patterns and incomplete samples cannot claim all five agree', async () => {
  for (const values of [[],[expected],Array(4).fill(expected),[expected,expected,expected,expected,'PRIVATE']]) {
    const r=await run({...opts,fetcher:async()=>Response.json({items:values.map(v=>row(v))})});
    const req=r.cells[0].requests[0];
    assert.equal(req.all_five_rows_same_safe_pattern,false);
    assert.equal(Object.values(req.component_counts).reduce((a,b)=>a+b,0),values.length);
  }
});

test('token-equivalent collections pass identity without relaxing other guards', async () => {
  for (const value of [expected.toUpperCase(),` ${expected} `,expected.replaceAll(' ','-'),'Mirage 2021']) {
    const r=row(value);
    assert.equal(observeP0Identity(r,cell,item,'NORMAL').source_collection,value);
    const report=await run({...opts,fetcher:async()=>Response.json({items:[r]})});
    assert.deepEqual(report.cells[0].requests[0].rejections,{});
    assert.equal(report.cells[0].requests[0].strict_identity_pass_count,1);
    assert.equal(r.attributes.cs2.collection,value);
  }
  for (const [mutate,code] of [
    [r=>r.attributes.name='PRIVATE_NAME','EXACT_NAME'],
    [r=>r.attributes.cs2.category='CATEGORY_STATTRAK','CATEGORY'],
    [r=>r.attributes.cs2.quality=null,'QUALITY_MISSING'],
    [r=>r.attributes.cs2.float=null,'FLOAT'],
    [r=>r.offerId=null,'LISTING']
  ]) {
    const r=row('Mirage 2021'); mutate(r);
    const report=await run({...opts,fetcher:async()=>Response.json({items:[r]})});
    assert.deepEqual(report.cells[0].requests[0].rejections,{[`DMARKET_P0_${code}`]:1});
  }
  const report=await run({...opts,fetcher:async()=>Response.json({items:[row()]})});
  assert.equal(report.cells[0].requests[0].strict_identity_pass_count,1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});

test('HTTP, transport, schema and byte bounds fail closed with no retry or raw exception', async () => {
  for (const status of [401,403,429,503]) {
    const r=await run({...opts,fetcher:async()=>new Response('',{status})});
    assert.equal(r.calls,1); assert.equal(r.error,`HTTP_${status}`);
  }
  for (const [body,error] of [['x'.repeat(1048577),'RESPONSE_CAP'],['PRIVATE_INVALID_JSON','INVALID_JSON'],['{}','RESPONSE_SCHEMA'],[JSON.stringify({items:Array(6).fill(row())}),'RESPONSE_SCHEMA']]) {
    const r=await run({...opts,fetcher:async()=>new Response(body)});
    assert.equal(r.calls,1); assert.equal(r.error,error); assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  }
  const r=await run({...opts,fetcher:async()=>{throw Error(env.DMARKET_SECRET_KEY)}});
  assert.equal(r.calls,1); assert.equal(r.error,'TRANSPORT_OR_SIGNING_UNAVAILABLE');
  assert.ok(!JSON.stringify(r).includes(env.DMARKET_SECRET_KEY));
  assert.equal((await run({env:{},fetcher:()=>assert.fail('network')})).calls,0);
});

test('deadline prevents a late second request and stops slow body consumption', async () => {
  let tick=0;
  const r=await run({...opts,now:()=>tick,pause:async()=>{tick=20000},fetcher:async()=>Response.json({items:[]})});
  assert.equal(r.calls,1); assert.equal(r.error,'PROBE_BUDGET');
  tick=0;
  const slow=await run({...opts,now:()=>tick,fetcher:async()=>{
    const response=new Response(new ReadableStream({pull(c){tick=30000;c.enqueue(new TextEncoder().encode('{}'));c.close()}}));
    return response;
  }});
  assert.equal(slow.calls,1); assert.equal(slow.error,'PROBE_BUDGET');
});

test('actual CLI JSON/log contains no raw provider fields or secrets', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = new URL('../scripts/check-dmarket-collection.mjs',import.meta.url);
  const code = `
    import { fileURLToPath } from 'node:url';
    globalThis.fetch = async () => Response.json({items:[${JSON.stringify(row('PRIVATE_COLLECTION','PRIVATE_NAME'))}],secret:'PRIVATE_PAYLOAD'});
    process.argv[1] = fileURLToPath(${JSON.stringify(script.href)});
    await import(${JSON.stringify(script.href)});
  `;
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{
    env:{...process.env,...env},timeout:5000
  });
  assert.equal(stderr,'');
  assert.equal(stdout.trim().split('\n').length,1);
  const report=JSON.parse(stdout); assert.equal(report.calls,2);
  for (const value of ['PRIVATE',env.DMARKET_SECRET_KEY,env.DMARKET_PUBLIC_KEY]) assert.ok(!stdout.includes(value));
});
