import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../backend/store.mjs';
import { createHandler } from '../backend/handler.mjs';
import { startServer } from '../backend/server.mjs';
import { normalizeScan, collectScan, COLLECTION, RARITY, REVISION, dmarketListingUrl } from '../backend/radar.mjs';
import { fetchOpportunities } from '../extension/api.js';
import { deriveHealthState } from '../extension/health-state.js';

const time = Date.parse('2026-10-03T21:00:00Z');
function scan() {
  return { ops: 'OPS-045', mode: 'MINI_SCAN_ROBUST_COMPARATOR', status: 'PASS',
    params: {source: 'DMarket', collection: COLLECTION, rarity: RARITY}, jobs: {planned: 10, completed: 10, error: 0}, errors: [],
    freshness: {captured_at: new Date(time).toISOString()}, opportunities: [
      { offer_id: 'test', skin: 'Test', variant: 'NORMAL', wear: 'Factory New', float: 0.03, normalized_float: 0.03,
        price_usd: 0.5, timestamp: new Date(time-1000).toISOString(), classification: 'CERTIFIED_SURVIVOR',
        listing_link: 'javascript:alert(1)', robust_comparator: {rule: 'CHEAPEST_EQUAL_OR_BETTER_NORMALIZED_FLOAT', peer_count: 4, gap_pct: 50, cheapest_price_usd: 1} }
    ] };
}
test('adapter preserves evidence, rejects incomplete/error/invalid certification and safely derives DMarket listing links', () => {
  assert.equal(dmarketListingUrl('offer-123'), 'https://dmarket.com/ingame-items/item-list/csgo-skins?userOfferId=offer-123');
  const snapshot = normalizeScan(scan(), time);
  assert.equal(snapshot.items[0].listing_url, 'https://dmarket.com/ingame-items/item-list/csgo-skins?userOfferId=test');
  assert.equal(snapshot.items[0].price_usd, 0.5);
  assert.equal(snapshot.items[0].status, 'CERTIFIED');
  const provided = scan();
  provided.opportunities[0].listing_link = 'https://www.dmarket.com/ingame-items/item-list/csgo-skins?userOfferId=upstream';
  assert.equal(normalizeScan(provided, time).items[0].listing_url, provided.opportunities[0].listing_link);
  for (const mutate of [s=>s.status='PARTIAL', s=>s.jobs.error=1, s=>s.params.source='CSFloat',
    s=>s.opportunities[0].robust_comparator.peer_count=3, s=>s.opportunities[0].timestamp='bad',
    s=>s.opportunities.push(s.opportunities[0]), s=>s.opportunities[0].variant='STATTRAK']) {
    const input = scan(); mutate(input); assert.throws(()=>normalizeScan(input,time));
  }
});
test('collector never scans an unexpected runtime revision', async () => {
  let calls=0;
  await assert.rejects(collectScan(async()=>{calls++; return Response.json({ok:true,revision:'other'});}), /REVISION_GATE/);
  assert.equal(calls,1);
});
test('API filters, validates queries, and derives freshness from oldest capture', async () => {
  const snapshot = normalizeScan(scan(),time);
  snapshot.items.push({...snapshot.items[0],id:'reject',status:'REJECTED'});
  const handler = createHandler({read:async()=>snapshot}, {now:()=>time+301000});
  const body = await (await handler(new Request('http://test/v1/opportunities'))).json();
  assert.equal(body.items.length,1); assert.equal(body.freshness_seconds,302); assert.equal(body.status,'STALE');
  for (const q of ['limit=NaN','limit=0','limit=101','since=invalid','status=REJECTED']) {
    assert.equal((await handler(new Request(`http://test/v1/opportunities?${q}`))).status,400);
  }
  assert.equal((await handler(new Request('http://test/v1/opportunities?since=2026-10-03T22:00:00Z'))).status,200);
  const empty = createHandler({read:async()=>null});
  assert.equal((await empty(new Request('http://test/v1/opportunities'))).status,503);
  assert.equal(deriveHealthState({endpointConfigured:true,payload:{freshness_seconds:null}}).state,'STALE');
});
test('atomic persistence survives recreation; lock prevents concurrent collection; real HTTP reaches extension client', async () => {
  const directory = await mkdtemp(join(tmpdir(),'tsr-'));
  let server;
  try {
    const store = new FileStore(directory);
    const release = await store.lock();
    await assert.rejects(store.lock(),{code:'EEXIST'});
    await release();
    await store.write(normalizeScan(scan(),time));
    const restarted = new FileStore(directory);
    assert.equal((await restarted.read()).items.length,1);
    server = await startServer({store:restarted,port:0});
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const payload = await fetchOpportunities({endpoint});
    assert.equal(payload.items[0].id,'dmarket:test');
    assert.equal((await fetch(`${endpoint}/v1/opportunities`,{headers:{origin:'https://attacker.test'}})).status,403);
    assert.equal((await fetch(`${endpoint}/v1/auth/steam`)).status,503);
  } finally {
    if(server) await new Promise(r=>server.close(r));
    await rm(directory,{recursive:true,force:true});
  }
});
