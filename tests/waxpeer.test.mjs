import test from 'node:test';
import assert from 'node:assert/strict';
import { waxpeerUsd, waxpeerVariant, createWaxpeerCatalog, normalizeWaxpeerListings,
  normalizeWaxpeerBids, waxpeerTiming, waxpeerCrossCheck, crossCheckWaxpeerOpportunity,
  createWaxpeerClient, MAX_SNAPSHOT_BYTES } from '../backend/waxpeer.mjs';
import { applyEconomicScoring, applyScoring } from '../backend/scoring.mjs';

const time = Date.parse('2026-10-08T12:00:00Z'), at = ms => new Date(ms).toISOString();
const title = 'Test skin (Factory New)'; // Synthetic membership, never a production catalog.
const headers = 'item_id,name,price,auto,inspect,unlock_at,send_until,class_id,instance_id,steam_id,merchant,delivery';
const row = ({ name = title, price = '000000001001', item = '101', ...more } = {}) => [item,
  `"${name.replaceAll('"', '""')}"`, price, 'true', 'steam://rungame/730/test', '', '', '123', '0', '', '', 'instant',
  ...Object.values(more)].join(',');
const csv = rows => headers + '\r\n' + rows.join('\r\n') + '\r\n';
const entry = (name = title, collection = 'Mirage 2021') => ({ market_hash_name: name,
  variant: waxpeerVariant(name), collection, rarity: 'Consumer Grade',
  evidence: { reference: 'SYNTHETIC_TEST_FIXTURE', observed_at: at(time) } });
const catalog = createWaxpeerCatalog([entry(), entry('Souvenir ' + title), entry('StatTrak™ ' + title)]);
const listings = (raw = csv([row()]), c = catalog) => normalizeWaxpeerListings(raw, { observedAt: at(time), catalog: c });
const bidPayload = (name = title, max = '2000', timestamp = time / 1000) => ({ success: true, timestamp,
  offers: [{ name, max, by: 'public-buyer-id', amount: 9999, filled: 0, bid_executable: true, source_status: 'SOURCE_VALIDATED' }] });
const bids = (raw = bidPayload(), c = catalog) => normalizeWaxpeerBids(raw, { observedAt: at(time), catalog: c });

test('USD-thousandths including zero padding retain integer audit value; malformed money rejects', () => {
  for (const [v, usd] of [['000000000001', 0.001], [1000, 1], ['1380000', 1380], ['000000012500', 12.5]]) assert.equal(waxpeerUsd(v), usd);
  for (const v of [null, undefined, '', ' ', true, {}, [], -1, 0, '1.1', 1.1, '1e3', ' 1000', Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => waxpeerUsd(v));
  const [item] = listings();
  assert.equal(item.raw_price, 1001); assert.equal(item.price_usd, 1.001);
  assert.equal(item.raw_currency, 'USD'); assert.equal(item.normalized_currency, 'USD');
  assert.equal(item.fx_rate_used, 1); assert.equal(item.fx_timestamp, null);
});

test('listing CSV parses escaped names, append-only columns, inspect and unknowns without float inference', () => {
  const raw = headers + ',float,extra\n' + row({ name: 'Test, "quoted" skin (Factory New)', float: '0.0001', extra: 'ignored' }) + '\n';
  const [item] = listings(raw);
  assert.equal(item.market_hash_name, 'Test, "quoted" skin (Factory New)');
  assert.equal(item.source_listing_id, '101'); assert.equal(item.inspect, 'steam://rungame/730/test');
  assert.equal(item.delivery, 'instant'); assert.equal(item.auto, true);
  assert.equal(item.source_timestamp, null); assert.equal(item.observed_at, at(time));
  assert.equal(item.timestamp_basis, 'INGESTION_ONLY_SOURCE_AGE_UNKNOWN');
  assert.equal(item.exact_float, null); assert.ok(!item.confidence_flags.includes('FLOAT_EXACT'));
  assert.equal(item.collection_id, null);
  const [empty] = listings('item_id,name,price,auto,inspect\n1,"Test",1000,,\n');
  assert.equal(empty.inspect, null); assert.equal(empty.delivery, null); assert.equal(empty.auto, null);
  assert.equal(empty.trade_locked, null);
  assert.deepEqual(listings(headers + '\n'), []);
});

test('trade lock and delivery retained as friction, never universal fees', () => {
  const raw = csv(['1,"' + title + '",1000,false,steam://rungame/730/test,2026-10-09T12:00:00Z,2026-10-10T12:00:00Z,,,,,hold',
    '2,"' + title + '",2000,false,,,,,,,,manual']);
  const [hold, manual] = listings(raw);
  assert.equal(hold.trade_locked, true); assert.equal(hold.unlock_at, '2026-10-09T12:00:00.000Z');
  assert.equal(manual.delivery, 'manual');
  const cross = waxpeerCrossCheck(hold, bids()[0], { now: time });
  assert.equal(cross.friction.delivery, 'hold'); assert.equal(cross.seller_fee_pct, 6);
  assert.equal(cross.withdrawal_fee_pct, null); assert.equal(cross.cash_withdrawal_hold_days_approx, 7);
});

test('invalid/truncated CSV, duplicate IDs, headers, dates and prices fail closed', () => {
  for (const raw of [csv([row(), row()]), headers + '\n1,"unterminated', headers + '\n1,name,2',
    'item_id,name,price,auto,inspect,price\n', csv([row({ price: 'NaN' })]),
    csv(['1,"Test",1000,false,,2026-02-30T00:00:00Z,,,,,,hold']),
    csv(['1,"Test",1000,TRUE,,,,,,,,regular']), csv(['1,"Test",1000,false,,,,,,,,hold'])]) {
    assert.throws(() => listings(raw));
  }
});

test('best buy order is a name-level reference; untrusted amount/flags cannot certify depth', () => {
  const [bid] = bids();
  assert.equal(bid.best_bid_usd, 2); assert.equal(bid.raw_price, 2000); assert.equal(bid.buyer_id, 'public-buyer-id');
  assert.equal(bid.source_timestamp, at(time)); assert.equal(bid.source_status, 'SOURCE_VALIDATING');
  assert.equal(bid.best_bid_qty, null); assert.equal(bid.bid_depth_5pct, null); assert.equal(bid.bid_executable, false);
  assert.deepEqual(bid.confidence_flags, ['PRICE_EXACT', 'BID_DEPTH_PARTIAL', 'SOURCE_VALIDATING']);
  for (const raw of [{ ...bidPayload(), success: false }, { ...bidPayload(), timestamp: null },
    bidPayload(title, 1.5), bidPayload(title, 2000, time / 1000 + 1),
    { ...bidPayload(), offers: [...bidPayload().offers, ...bidPayload().offers] }]) assert.throws(() => bids(raw));
});

test('60s preferred / 180s hard limits include boundaries and reject stale aligned pairs, future and absent time', () => {
  const ask = listings()[0], bid = bids()[0];
  for (const [seconds, status] of [[0, 'PREFERRED'], [60, 'PREFERRED'], [60.001, 'WITHIN_HARD_CAP'],
    [180, 'WITHIN_HARD_CAP'], [180.001, 'BLOCKED']]) {
    const oldBid = { ...bid, source_timestamp: at(time - seconds * 1000) };
    assert.equal(waxpeerTiming(ask, oldBid, time).status, status);
    const cross = waxpeerCrossCheck(ask, oldBid, { now: time });
    assert.equal(cross.exit_reference_usd, status === 'BLOCKED' ? null : 2);
    assert.equal(cross.balance_after_standard_percentage_fee_usd, status === 'BLOCKED' ? null : 1.88);
  }
  assert.equal(waxpeerTiming(ask, bid, time + 181000).status, 'BLOCKED');
  assert.equal(waxpeerTiming(ask, { ...bid, source_timestamp: at(time + 1) }, time).status, 'BLOCKED');
  assert.equal(waxpeerTiming(ask, { ...bid, source_timestamp: null }, time).status, 'BLOCKED');
  assert.equal(waxpeerTiming({ ...ask, observed_at: null }, bid, time).status, 'BLOCKED');
});

test('partial 6% fee never invents acquisition/cash-out net, quantity, executed sales or actionable tiers', () => {
  const cross = waxpeerCrossCheck(listings()[0], bids()[0], { now: time });
  assert.equal(cross.status, 'REFERENCE_ONLY'); assert.equal(cross.fee_status, 'FEES_PARTIAL');
  assert.equal(cross.seller_fee_pct, 6); assert.equal(cross.balance_after_standard_percentage_fee_usd, 1.88);
  assert.equal(cross.bid_depth_status, 'BID_DEPTH_PARTIAL'); assert.equal(cross.source_status, 'SOURCE_VALIDATING');
  for (const key of ['buyer_fee_pct', 'buyer_fee_fixed', 'seller_fee_fixed', 'withdrawal_fee_pct', 'withdrawal_fee_fixed',
    'deposit_fee_pct', 'net_exit_usd', 'acquisition_cost_usd', 'estimated_net_profit_usd', 'estimated_net_margin_pct',
    'best_bid_qty', 'bid_depth_2pct', 'bid_depth_5pct', 'bid_depth_10pct', 'sale_count_window', 'economic_action_score']) assert.equal(cross[key], null, key);
  for (const flag of ['BID_EXECUTABLE', 'SOURCE_VALIDATED', 'FEES_KNOWN', 'SALES_EXECUTED']) assert.ok(!cross.confidence_flags.includes(flag));
  assert.equal(cross.action_tier, 'BLOCKED'); assert.equal(cross.bid_executable, false);
});

test('NORMAL/SOUVENIR/STATTRAK never share references or catalog entries; unsupported variant spellings reject', () => {
  const titles = [title, 'Souvenir ' + title, 'StatTrak™ ' + title];
  const a = listings(csv(titles.map((name, i) => row({ name, item: String(i) }))));
  const b = titles.map(name => bids(bidPayload(name))[0]);
  assert.deepEqual(a.map(x => x.variant), ['NORMAL', 'SOUVENIR', 'STATTRAK']);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    assert.equal(waxpeerCrossCheck(a[i], b[j], { now: time }).status, i === j ? 'REFERENCE_ONLY' : 'BLOCKED');
  }
  for (const name of ['Souvenir StatTrak™ Test', 'StatTrak Test', 'StatTrak™ Souvenir Test']) assert.throws(() => waxpeerVariant(name));
  assert.equal(waxpeerVariant('Berlin 2019 Mirage Souvenir Package'), 'NORMAL'); // Not a prefixed skin; no catalog identity.
  assert.throws(() => createWaxpeerCatalog([{ ...entry(), variant: 'STATTRAK' }]));
});

test('registry aliases canonicalize but generations/rarities and ambiguous membership never mix', () => {
  assert.equal(listings()[0].collection_id, 'mirage-2021');
  assert.equal(listings()[0].generation, '2021');
  const legacy = createWaxpeerCatalog([entry(title, 'Train')]);
  const modern = createWaxpeerCatalog([entry(title, 'Train 2021')]);
  assert.equal(waxpeerCrossCheck(listings(csv([row()]), legacy)[0], bids(bidPayload(), modern)[0], { now: time }).status, 'BLOCKED');
  assert.equal(waxpeerCrossCheck(listings(csv([row()]), createWaxpeerCatalog())[0], bids()[0], { now: time }).status, 'BLOCKED');
  assert.throws(() => createWaxpeerCatalog([entry(title, 'The Mirage Collection')]));
  assert.throws(() => createWaxpeerCatalog([entry(title, 'Train'), entry(title, 'Train 2021')]));
  assert.throws(() => createWaxpeerCatalog([{ ...entry(), evidence: null }]));
  const industrial = createWaxpeerCatalog([{ ...entry(), rarity: 'Industrial Grade' }]);
  assert.equal(waxpeerCrossCheck(listings()[0], bids(bidPayload(), industrial)[0], { now: time }).status, 'BLOCKED');
  assert.equal(waxpeerCrossCheck({ ...listings()[0], generation: 'legacy' }, bids()[0], { now: time }).status, 'BLOCKED');
});

test('DMarket cross-check is separate and Waxpeer-only exit cannot promote even with fake COMPLETE/high scores', () => {
  const original = applyScoring({ source: 'DMarket', collection_id: 'mirage-2021', collection: 'Mirage 2021',
    rarity: 'Consumer Grade', market_hash_name: title, is_souvenir: false, is_stattrak: false,
    captured_at: at(time), price_usd: 0.01, status: 'CERTIFIED', normalized_float: 0.001,
    robust_gap_pct: 100, peer_count: 20, listing_url: 'https://dmarket.com/test' });
  const before = structuredClone(original);
  const ref = crossCheckWaxpeerOpportunity(original, bids(), { catalog, now: time });
  assert.equal(ref.status, 'REFERENCE_ONLY'); assert.deepEqual(original, before);
  for (const evidence of [ref, { ...ref, status: 'COMPLETE', estimated_margin_pct: 10000, depth_5pct_quantity: 99999,
    sales_history: { sample_count: 99999, latest_sale_age_days: 0 }, spread_pct: -100 }]) {
    const result = applyEconomicScoring(original, evidence);
    assert.equal(result.action_tier, 'BLOCKED'); assert.equal(result.economic_action_score, null);
  }
  for (const change of [{ collection: 'Train' }, { generation: 'legacy' }, { is_souvenir: true }, { rarity: 'Industrial Grade' }]) {
    assert.equal(crossCheckWaxpeerOpportunity({ ...original, ...change }, bids(), { catalog, now: time }).status, 'BLOCKED');
  }
});

test('public ingestion makes only two credential-free GETs and ignores exact-float availability', async () => {
  const calls = [];
  const client = createWaxpeerClient({ now: () => time, env: { WAXPEER_API_KEY: 'must-not-be-sent' },
    fetcher: async (url, options) => {
      const u = new URL(url); calls.push(u);
      assert.equal(u.origin, 'https://api.waxpeer.com'); assert.equal(u.searchParams.has('api'), false);
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      return u.pathname === '/v1/prices/snapshot' ? new Response(csv([row()])) : Response.json(bidPayload());
    } });
  const result = await client.publicSnapshots({ catalog });
  assert.equal(calls.length, 2); assert.equal(calls[0].searchParams.get('include_hold'), '1');
  assert.equal(calls[0].searchParams.get('format'), 'csv'); assert.equal(calls[1].pathname, '/v1/buy-orders/snapshot');
  assert.equal(result.listings[0].exact_float, null); assert.equal(result.cross_checks[0].status, 'REFERENCE_ONLY');
  assert.equal(result.source_status, 'SOURCE_VALIDATING');
});

test('large listing snapshots stop at 1000 complete CSV rows across UTF-8/quote/newline chunks and disclose partial coverage', async () => {
  const name = 'Test, "quoted"\nmultiline ★ skin';
  const buffer = new TextEncoder().encode(csv(Array.from({ length: 1002 }, (_, i) => row({ name, item: String(i) }))));
  let offset = 0, cancelled = false;
  const stream = new ReadableStream({ pull(controller) {
    if (offset >= buffer.length) return controller.close();
    controller.enqueue(buffer.subarray(offset, offset + 127)); offset += 127;
  }, cancel() { cancelled = true; } });
  const client = createWaxpeerClient({ now: () => time, fetcher: async url => new URL(url).pathname.includes('prices')
    ? new Response(stream) : Response.json(bidPayload()) });
  const result = await client.publicSnapshots();
  assert.equal(result.listings.length, 1000); assert.equal(result.listings[999].item_id, '999');
  assert.equal(result.listings[0].market_hash_name, name); assert.equal(cancelled, true);
  assert.equal(result.listing_coverage, 'BOUNDED_PREFIX_NOT_FULL_SNAPSHOT');
});

test('429 Retry-After/backoff, failure/oversize/redirect/network errors are bounded and sanitized', async () => {
  let clock = time, calls = 0;
  const client = createWaxpeerClient({ now: () => clock, fetcher: async () => { calls++;
    return new Response('limited', { status: 429, headers: { 'Retry-After': '120' } }); } });
  await assert.rejects(client.publicSnapshots(), e => e.message === 'WAXPEER_HTTP_429' && e.retryAt === time + 120000);
  clock += 60000;
  await assert.rejects(client.publicSnapshots(), /WAXPEER_BACKOFF/); assert.equal(calls, 1);
  for (const fetcher of [async () => { throw new Error('secret-url'); },
    async () => new Response('', { headers: { 'content-length': String(MAX_SNAPSHOT_BYTES + 1) } }),
    async () => new Response('bad html'), async () => new Response(null, { status: 302 }),
    async () => Response.json({ success: false })]) {
    await assert.rejects(createWaxpeerClient({ fetcher, now: () => time }).publicSnapshots(), e => !e.message.includes('secret-url'));
  }
});

test('exact float makes zero requests without BOTH explicit authorization and configured key', async () => {
  for (const env of [{}, { WAXPEER_API_KEY: 'test-only' }, { WAXPEER_EXACT_FLOAT_AUTHORIZED: 'true' },
    { WAXPEER_EXACT_FLOAT_AUTHORIZED: 'false', WAXPEER_API_KEY: 'test-only' }]) {
    const result = await createWaxpeerClient({ env, fetcher: () => assert.fail('no private requests') }).exactFloat(listings()[0]);
    assert.equal(result.exact_float, null); assert.equal(result.status, 'N_D');
    assert.equal(result.source_timestamp, null);
  }
});

test('authorized future capability accepts only factual exact item_id/name/price/float within time cap', async () => {
  const env = { WAXPEER_EXACT_FLOAT_AUTHORIZED: 'true', WAXPEER_API_KEY: 'test-only-not-a-secret' };
  const matched = { item_id: '101', name: title, price: 1001, float: 0.01234 };
  const run = (record, clock = time) => createWaxpeerClient({ env, now: () => clock, fetcher: async (url, options) => {
    const u = new URL(url); assert.equal(u.pathname, '/v2/get-items-list'); assert.equal(u.searchParams.get('api'), env.WAXPEER_API_KEY);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return Response.json({ success: true, items: [record], has_more: false });
  } }).exactFloat(listings()[0]);
  const good = await run(matched);
  assert.equal(good.exact_float, 0.01234); assert.equal(good.status, 'FLOAT_EXACT'); assert.equal(good.source_timestamp, null);
  assert.equal(good.timestamp_basis, 'AUTHORIZED_ENDPOINT_INGESTION_ONLY');
  for (const change of [{ item_id: 'other' }, { name: 'Souvenir ' + title }, { price: 1002 }, { float: null }, { float: '0.1' }, { float: -1 }, { float: 1.1 }]) {
    assert.equal((await run({ ...matched, ...change })).status, 'N_D');
  }
  assert.equal((await run(matched, time + 180001)).status, 'N_D');
  assert.equal((await run(matched, time - 1)).status, 'N_D');
});

test('exact-float cursor pagination is bounded, repeated cursors reject and private errors never leak', async () => {
  const env = { WAXPEER_EXACT_FLOAT_AUTHORIZED: 'true', WAXPEER_API_KEY: 'test-only-not-a-secret' };
  let calls = 0;
  const client = createWaxpeerClient({ env, now: () => time, fetcher: async () => { calls++;
    return Response.json({ success: true, items: [], has_more: true, next_cursor: `cursor-${calls}` }); } });
  const result = await client.exactFloat(listings()[0]);
  assert.equal(calls, 3); assert.equal(result.reason, 'PAGE_BUDGET_EXHAUSTED');
  const error = await createWaxpeerClient({ env, fetcher: async () => { throw new Error(env.WAXPEER_API_KEY); } }).exactFloat(listings()[0]);
  assert.equal(error.status, 'N_D'); assert.ok(!JSON.stringify(error).includes(env.WAXPEER_API_KEY));
  calls = 0;
  const repeated = await createWaxpeerClient({ env, now: () => time, fetcher: async () => { calls++;
    return Response.json({ success: true, items: [], has_more: true, next_cursor: 'same' }); } }).exactFloat(listings()[0]);
  assert.equal(calls, 2); assert.equal(repeated.status, 'N_D');
});
