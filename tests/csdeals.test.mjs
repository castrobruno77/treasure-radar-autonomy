import test from 'node:test';
import assert from 'node:assert/strict';
import { csdealsUsd, csdealsName, normalizeCsDealsListing, normalizeCsDealsListings,
  normalizeCsDealsAverages, normalizeCsDealsSales, csdealsPatientResale, createCsDealsClient } from '../backend/csdeals.mjs';
import catalog from '../backend/csdeals-catalog.json' with { type: 'json' };
import { applyEconomicScoring, applyScoring } from '../backend/scoring.mjs';
const observedAt = '2026-10-09T10:00:00.000Z', now = Date.parse(observedAt);
const name = 'MAC-10 | Sienna Damask (Field-Tested)';
const listing = () => ({ id: 42, app_id: 730, market_hash_name: name, price: 1234, amount: 1,
  steam_asset_id: '123456789', created_at: '2026-09-01T00:00:00Z', trade_locked_until: null,
  cs_paint_wear: .2, cs_paint_index: 101, cs_paint_seed: 5, cs_inspect_link: 'steam://rungame/730/test',
  cs_wear: 'Field-Tested', cs_rarity: 'Consumer Grade', cs_collection: 'The 2021 Mirage Collection',
  cs_is_stattrak: false, cs_is_souvenir: false });
const avg = () => ({ window_days: 30, generated_at: observedAt, averages: [
  { app_id: 730, market_hash_name: name, average_price: 3000, sales: 10, volume: 12 }] });
const sold = () => ({ sales: [1, 2, 3].map(d => ({ app_id: 730, market_hash_name: name, price: 2900 + d,
  amount: 1, sold_at: new Date(now - d * 86400000).toISOString() })),
  metadata: { current_page: 1, current_limit: 100, total_items: 3, total_pages: 1 } });
const norm = r => normalizeCsDealsListing(r, { observedAt });
const history = p => normalizeCsDealsSales(p, { observedAt, marketHashName: name });
const average = p => normalizeCsDealsAverages(p, { observedAt })[0];
const reference = (a = norm(listing()), b = average(avg()), c = history(sold()), time = now) => csdealsPatientResale(a,b,c,{now:time});

test('cents normalization rejects null, strings, fractional and invalid money', () => {
  assert.equal(csdealsUsd(1234), 12.34); assert.equal(csdealsUsd(0), 0);
  for (const v of [null, undefined, '100', -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => csdealsUsd(v));
});
test('listing stable identity, exact source float, inspect, wear, lock and timestamp separation', () => {
  const r = norm(listing()); assert.equal(r.source_listing_id, '42'); assert.equal(r.exact_float,.2);
  assert.equal(r.price_usd,12.34); assert.equal(r.collection_id,'mirage-2021'); assert.equal(r.generation,'2021');
  assert.equal(r.cs_rarity,'Consumer Grade'); assert.equal(r.source_timestamp,null); assert.equal(r.observed_at,observedAt);
  assert.equal(r.trade_locked,null); assert.equal(r.inspect,listing().cs_inspect_link);
  assert.equal(norm({...listing(),trade_locked_until:'2026-10-10T10:00:00Z'}).trade_locked,true);
});
test('required listing evidence never defaults to zero or inferred float', () => {
  for (const key of ['id','steam_asset_id','price','cs_paint_wear','cs_inspect_link','cs_collection','cs_rarity','cs_wear',
    'cs_is_stattrak','cs_is_souvenir','created_at']) assert.throws(() => norm({...listing(),[key]:null}),key);
  for(const f of ['0.2',NaN,-1,1.1,.1,.61]) assert.throws(()=>norm({...listing(),cs_paint_wear:f}));
});
test('NORMAL and SOUVENIR are separate, contradictory flags rejected; STATTRAK never reassigned to P0', () => {
  assert.equal(norm({...listing(),market_hash_name:`Souvenir ${name}`,cs_is_souvenir:true}).variant,'SOUVENIR');
  assert.equal(csdealsName(`StatTrak™ ${name}`).variant,'STATTRAK');
  assert.throws(()=>norm({...listing(),market_hash_name:`StatTrak™ ${name}`,cs_is_stattrak:true}));
  assert.throws(()=>norm({...listing(),cs_is_souvenir:true}));
  assert.throws(()=>norm({...listing(),cs_is_souvenir:true,cs_is_stattrak:true}));
});
test('catalog captures 70 factual rows and no runtime activation; souvenir origin is mandatory', () => {
  assert.equal(catalog.items.length,70); assert.equal(catalog.items.filter(r=>r.rarity==='Consumer Grade').length,39);
  assert.equal(catalog.items.filter(r=>r.rarity==='Industrial Grade').length,31);
  assert.ok(catalog.items.every(r=>r.stattrak_allowed===false && r.normal_allowed && r.evidence_url));
  assert.throws(()=>norm({...listing(),market_hash_name:'Souvenir MP7 | Scorched (Field-Tested)',
    cs_is_souvenir:true,cs_collection:'The Norse Collection'}));
});
test('all catalog rows validate using exact native collection, rarity and factual float bounds', () => {
  for(const r of catalog.items) {
    const f = Math.max(r.float_min,.01), wear=f<.07?'Factory New':'Minimal Wear';
    const a=norm({...listing(),market_hash_name:`${r.base_name} (${wear})`,cs_paint_wear:f,cs_wear:wear,
      cs_collection:r.collection_id,cs_rarity:r.rarity});
    assert.equal(a.collection_id,r.collection_id);
    if(r.souvenir_allowed) assert.equal(norm({...listing(),market_hash_name:`Souvenir ${r.base_name} (${wear})`,
      cs_paint_wear:f,cs_wear:wear,cs_collection:r.collection_id,cs_rarity:r.rarity,cs_is_souvenir:true}).variant,'SOUVENIR');
  }
});
test('generation-safe aliases, reused finishes and rarity mismatch fail closed', () => {
  assert.equal(norm({...listing(),cs_collection:'Mirage 2021'}).collection_id,'mirage-2021');
  for(const c of ['Mirage','The Mirage Collection','The Vertigo Collection','The 2021 Vertigo Collection'])
    assert.throws(()=>norm({...listing(),cs_collection:c}));
  assert.throws(()=>norm({...listing(),cs_rarity:'Industrial Grade'}));
  assert.throws(()=>norm({...listing(),market_hash_name:'MAC-10 | Indigo (Field-Tested)'}));
});
test('bounded listings reject duplicate IDs, retain safe rejection counts, partial coverage explicit', () => {
  const p=normalizeCsDealsListings({listings:[listing(),{...listing(),id:43,cs_paint_wear:null}],next_cursor:43},{observedAt});
  assert.equal(p.listings.length,1); assert.equal(p.rejected.CSDEALS_FLOAT,1); assert.match(p.coverage,/BOUNDED/);
  assert.throws(()=>normalizeCsDealsListings({listings:[listing(),listing()],next_cursor:null},{observedAt}));
});
test('30 day weighted average retains counts, volume and provenance; no fabricated median', () => {
  const a=average(avg()); assert.equal(a.price_usd,30); assert.equal(a.sales,10); assert.equal(a.volume,12);
  assert.equal(a.window_days,30); assert.equal(a.exact_float,null);
  for(const key of ['average_price','sales','volume']) {const p=avg();p.averages[0][key]=null;assert.throws(()=>average(p));}
  assert.throws(()=>average({...avg(),window_days:7}));
  assert.throws(()=>average({...avg(),generated_at:'2026-10-10T00:00:00Z'}));
});
test('executed sales are bounded historical rows, not float comps or bids', () => {
  const p=history(sold());assert.equal(p.sales.length,3);assert.equal(p.complete_30d_window,false);
  assert.ok(p.sales.every(r=>r.confidence_flags.includes('SALES_EXECUTED') && r.exact_float===null && r.source_listing_id===null));
  assert.ok(p.sales.every(r=>r.confidence_flags.includes('SALE_SETTLEMENT_UNVERIFIED')));
  const bad=sold();bad.sales[0].market_hash_name=`Souvenir ${name}`;assert.throws(()=>history(bad));
  const future=sold();future.sales[0].sold_at='2026-10-10T00:00:00Z';assert.throws(()=>history(future));
  const reversed=sold();reversed.sales.reverse();assert.throws(()=>history(reversed));
  assert.throws(()=>history({...sold(),metadata:{...sold().metadata,total_items:40}}));
});
test('PATIENT_RESALE fees 0/2 only partial, cash-out unknown, no executable exit or score', () => {
  const r=reference();assert.equal(r.status,'REFERENCE_ONLY');assert.equal(r.evidence_mode,'PATIENT_RESALE');
  assert.equal(r.exit_reference_usd,30);assert.equal(r.balance_after_standard_percentage_fee_usd,29.4);
  assert.equal(r.buyer_fee_pct,0);assert.equal(r.seller_fee_pct,2);assert.equal(r.fee_status,'FEES_PARTIAL');
  for(const k of ['seller_fee_fixed','withdrawal_fee_pct','withdrawal_fee_fixed','net_exit_usd','economic_action_score',
    'estimated_net_profit_usd','recent_sale_median','history_exact_float','best_bid_usd']) assert.equal(r[k],null);
  assert.equal(r.bid_executable,false);assert.equal(r.action_tier,'BLOCKED');assert.equal(r.source_status,'SOURCE_VALIDATING');
  assert.ok(!JSON.stringify(r).match(/QUICK_EXIT|BID_EXECUTABLE|SOURCE_VALIDATED/));
});
test('sample minima, bounded tuple deduplication, window and recency guards', () => {
  for(const count of [0,1,4]) {const p=avg();p.averages[0].sales=count;const a=count?average(p):{...average(avg()),sales:0};assert.equal(reference(undefined,a).status,'BLOCKED');}
  const duplicate=sold();duplicate.sales=[duplicate.sales[0],duplicate.sales[0],duplicate.sales[0]];
  assert.equal(reference(undefined,undefined,history(duplicate)).status,'BLOCKED');
  const old=sold();old.sales.forEach((r,i)=>r.sold_at=new Date(now-(31+i)*86400000).toISOString());
  assert.equal(reference(undefined,undefined,history(old)).status,'BLOCKED');
  const week=sold();week.sales.forEach((r,i)=>r.sold_at=new Date(now-(8+i)*86400000).toISOString());
  assert.equal(reference(undefined,undefined,history(week)).status,'BLOCKED');
});
test('observation 180s and average cache 900s boundaries, future/invalid evidence blocked', () => {
  assert.equal(reference(undefined,undefined,undefined,now+180000).status,'REFERENCE_ONLY');
  assert.equal(reference(undefined,undefined,undefined,now+180001).status,'BLOCKED');
  const a={...average(avg()),source_timestamp:new Date(now-900000).toISOString()};
  assert.equal(reference(undefined,a).status,'REFERENCE_ONLY');a.source_timestamp=new Date(now-900001).toISOString();
  assert.equal(reference(undefined,a).status,'BLOCKED');assert.equal(reference(undefined,undefined,undefined,now-1).status,'BLOCKED');
  assert.equal(csdealsPatientResale(null,null,null).status,'BLOCKED');
});
test('history never crosses variant, generation or collection; fake source certification ignored', () => {
  for(const f of [NaN,Infinity,.9,null]) assert.equal(reference({...norm(listing()),exact_float:f}).status,'BLOCKED');
  for(const patch of [{variant:'SOUVENIR'},{generation:'legacy'},{collection_id:'vertigo-2021'},
    {source_status:'SOURCE_VALIDATED'},{raw_price:3001}]) assert.equal(reference(undefined,{...average(avg()),...patch}).status,'BLOCKED');
  const r=norm({...listing(),confidence_flags:['SOURCE_VALIDATED','BID_EXECUTABLE']});assert.deepEqual(r.confidence_flags,['PRICE_EXACT','FLOAT_EXACT','SOURCE_VALIDATING']);
});
test('CS.Deals alone cannot promote a certified DMarket opportunity, even if reference is forged COMPLETE', () => {
  const item=applyScoring({source:'DMarket',status:'CERTIFIED',robust_gap_pct:50,normalized_float:.01,peer_count:100,listing_url:'https://example.com'});
  for(const e of [reference(),{...reference(),status:'COMPLETE',estimated_net_margin_pct:999}]) {
    const r=applyEconomicScoring(item,e);assert.equal(r.action_tier,'BLOCKED');assert.equal(r.economic_action_score,null);
  }
});
test('no credential or authorization means zero network calls', async () => {
  let calls=0;for(const env of [{},{CSDEALS_API_KEY:'test'},{CSDEALS_READ_ONLY_AUTHORIZED:'true'}]) {
    const c=createCsDealsClient({env,fetcher:async()=>{calls++;}});await assert.rejects(c.listings(),/AUTHORIZED_KEY/);
  } assert.equal(calls,0);
});
test('client is GET-only fixed origin, header auth, bounded read routes and per-endpoint pacing', async () => {
  let time=now;const calls=[];const c=createCsDealsClient({env:{CSDEALS_API_KEY:'fixture-only',CSDEALS_READ_ONLY_AUTHORIZED:'true'},now:()=>time,
    fetcher:async(u,o)=>{calls.push([u,o]);return Response.json({ok:true});}});
  await c.listings();await assert.rejects(c.listings(),/BACKOFF/);time+=1100;await c.listings({cursor:42});
  await c.averages();await c.sales(name);await assert.rejects(c.sales(name),/BACKOFF/);
  assert.deepEqual(Object.keys(c),['listings','averages','sales']);
  for(const [u,o] of calls) {assert.equal(u.origin,'https://api.cs.deals');assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.searchParams.get('api_key'),null);assert.equal(o.headers.Authorization,'Bearer fixture-only');}
  assert.equal(calls[0][0].searchParams.get('limit'),'500');assert.equal(calls[3][0].searchParams.get('market_hash_name'),name);
});
test('HTTP, redirect/network and malformed bodies cannot leak credential or server text; 429 backoff', async () => {
  const env={CSDEALS_API_KEY:'fixture-private-token',CSDEALS_READ_ONLY_AUTHORIZED:'true'};
  const c=createCsDealsClient({env,now:()=>now,fetcher:async()=>new Response('fixture-private-token',{status:429,headers:{'Retry-After':'60'}})});
  await assert.rejects(c.listings(),{message:'CSDEALS_HTTP_429'});await assert.rejects(c.listings(),/BACKOFF/);
  const bad=createCsDealsClient({env,fetcher:async()=>{throw Error('fixture-private-token');}});
  await assert.rejects(bad.listings(),{message:'CSDEALS_READ_UNAVAILABLE'});
  const json=createCsDealsClient({env,fetcher:async()=>new Response('fixture-private-token')});
  await assert.rejects(json.listings(),{message:'CSDEALS_RESPONSE_INVALID'});
});
