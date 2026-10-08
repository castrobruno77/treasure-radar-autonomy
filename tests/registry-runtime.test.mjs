import test from 'node:test';
import assert from 'node:assert/strict';
import { collectScan, normalizeScan, REVISION, SCAN_TELEMETRY } from '../backend/radar.mjs';
import { pilotScanPlan } from '../backend/scan-plan.mjs';

const now = Date.parse('2026-10-08T00:00:00Z');
function raw() {
  return { ops:'OPS-045',mode:'MINI_SCAN_ROBUST_COMPARATOR',status:'PASS',
    params:{source:'DMarket',collection:'Mirage 2021',rarity:'Consumer Grade'},
    jobs:{planned:10,completed:10,error:0},errors:[],freshness:{captured_at:new Date(now).toISOString()},
    opportunities:['NORMAL','SOUVENIR'].map((variant,i) => ({offer_id:`offer-${i}`,skin:'Test skin',variant,
      timestamp:new Date(now-1000).toISOString(),price_usd:1,float:0.01,normalized_float:0.01,
      classification:'CERTIFIED_SURVIVOR',wear:'Factory New',
      robust_comparator:{rule:'CHEAPEST_EQUAL_OR_BETTER_NORMALIZED_FLOAT',peer_count:4,gap_pct:50,cheapest_price_usd:2}})) };
}

test('real collector code consumes registry plan, canonicalizes response and exposes canonical collection yield', async () => {
  const calls=[];
  const snapshot=await collectScan(async url => {
    calls.push(new URL(url));
    return Response.json(calls.length===1 ? {ok:true,revision:REVISION} : raw());
  }, {env:{},now:()=>now});
  const plan=pilotScanPlan();
  assert.equal(calls.length,2);
  assert.equal(calls[1].searchParams.get('collection'),plan.collection);
  assert.equal(calls[1].searchParams.get('rarity'),plan.rarity);
  assert.equal(calls[1].searchParams.get('max_jobs'),String(plan.jobs));
  assert.equal(snapshot.scope.collection,'The 2021 Mirage Collection');
  assert.equal(snapshot[SCAN_TELEMETRY].collection,plan.collection);
  assert.equal(snapshot[SCAN_TELEMETRY].candidate_count,2);
  assert.equal(snapshot[SCAN_TELEMETRY].certified_count,2);
  assert.notEqual(snapshot.items[0].comparator_pool_key,snapshot.items[1].comparator_pool_key);
  assert.equal(snapshot.items[0].market_hash_name,'Test skin (Factory New)');
  assert.equal(snapshot.items[1].market_hash_name,'Souvenir Test skin (Factory New)');
  for (const item of snapshot.items) {
    assert.equal(item.collection_id,'mirage-2021');
    assert.equal(item.collection_priority_tier,'P0');
  }
});

test('runtime rejects generation/rarity/variant conflicts before publishing any snapshot', () => {
  for (const mutate of [
    s=>s.params.collection='The Mirage Collection',
    s=>s.params.collection='The 2021 Vertigo Collection',
    s=>s.params.rarity='Industrial Grade',
    s=>s.opportunities[0].collection='The Mirage Collection',
    s=>s.opportunities[0].collection=null,
    s=>s.opportunities[0].collection='The 2021 Vertigo Collection',
    s=>s.opportunities[0].rarity='Industrial Grade',
    s=>s.opportunities[0].variant='STATTRAK',
    s=>s.opportunities[0].skin='Souvenir Test skin',
    s=>s.opportunities[0].skin='StatTrak™ Test skin',
    s=>s.opportunities[0].robust_comparator.collection='The Mirage Collection',
    s=>s.opportunities[0].robust_comparator.rarity='Industrial Grade',
    s=>s.opportunities[0].robust_comparator.variant='SOUVENIR',
    s=>s.opportunities[0].robust_comparator.variant=null,
  ]) { const input=raw(); mutate(input); assert.throws(()=>normalizeScan(input,now)); }
  const input=raw();
  input.opportunities[0].collection='2021 Mirage';
  assert.equal(normalizeScan(input,now).items[0].collection,'The 2021 Mirage Collection');
});

test('collector rejects an old-generation response instead of relabeling it', async () => {
  let calls=0;
  const input=raw(); input.params.collection='The Mirage Collection';
  await assert.rejects(collectScan(async()=>Response.json(++calls===1 ? {ok:true,revision:REVISION} : input),
    {env:{},now:()=>now}),/UNKNOWN_COLLECTION/);
});
