import catalog from './csdeals-catalog.json' with { type: 'json' };
import { resolveCollection } from './collection-registry.mjs';
import { validateCsDealsInspect } from './csdeals-inspect.mjs';

export const CSDEALS_VERSION = 'CSDEALS_READ_ONLY_V1';
export const CSDEALS_GUARDS = Object.freeze({ minSales: 5, minVolume: 5, minSample: 3,
  windowDays: 30, maxAverageAgeSeconds: 900, maxObservationAgeSeconds: 180, maxLatestSaleAgeDays: 7 });
const fail = code => { throw new Error(`CSDEALS_${code}`); };
const str = v => typeof v === 'string' && v.length > 0 && v.length <= 500;
const integer = v => Number.isSafeInteger(v) && v >= 0;
const positive = v => integer(v) && v > 0;
const stamp = v => {
  if (!str(v) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail('TIMESTAMP');
  return new Date(v).toISOString();
};
export function csdealsUsd(cents) {
  if (!integer(cents)) fail('CENTS');
  return cents / 100;
}
const money = cents => ({ raw_price: cents, raw_price_unit: 'USD_CENTS', price_usd: csdealsUsd(cents),
  raw_currency: 'USD', normalized_currency: 'USD', fx_rate_used: 1, fx_timestamp: null });
const source = () => ({ source: 'CSDEALS', source_status: 'SOURCE_VALIDATING', version: CSDEALS_VERSION });
const wears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
const wearBounds = [[0, .07], [.07, .15], [.15, .38], [.38, .45], [.45, 1.0000001]];

export function csdealsName(name) {
  if (!str(name)) fail('NAME');
  const match = name.match(/^(Souvenir |StatTrak™ )?(.+ \| .+) \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/);
  if (!match) fail('NAME');
  return { market_hash_name: name, base_name: match[2], wear: match[3],
    variant: match[1] === 'Souvenir ' ? 'SOUVENIR' : match[1] ? 'STATTRAK' : 'NORMAL' };
}
function membership(name, collection, rarity) {
  const parsed = csdealsName(name), c = resolveCollection(collection);
  const matches = catalog.items.filter(r => r.base_name === parsed.base_name && r.collection_id === c.id &&
    r.generation === c.generation && r.rarity === rarity);
  if (matches.length !== 1) fail('MEMBERSHIP');
  const row = matches[0];
  if (!row[`${parsed.variant.toLowerCase()}_allowed`]) fail('VARIANT_PROVENANCE');
  return { ...parsed, collection_id: c.id, collection: c.name, generation: c.generation, rarity,
    float_min: row.float_min, float_max: row.float_max, identity_evidence: `#63/${catalog.version}`, mapping_evidence: '#64' };
}
function historyIdentity(name) {
  const parsed = csdealsName(name);
  const rows = catalog.items.filter(r => r.base_name === parsed.base_name);
  if (rows.length !== 1) fail('HISTORY_IDENTITY_AMBIGUOUS');
  return membership(name, rows[0].collection_id, rows[0].rarity);
}

export function normalizeCsDealsListing(r, { observedAt } = {}) {
  const observed_at = stamp(observedAt);
  if (r?.app_id !== 730 || !positive(r.id) || !positive(r.price) || r.amount !== 1 ||
      !str(r.steam_asset_id) || !/^\d+$/.test(r.steam_asset_id)) fail('LISTING');
  const parsed = csdealsName(r.market_hash_name);
  if (typeof r.cs_is_stattrak !== 'boolean' || typeof r.cs_is_souvenir !== 'boolean' ||
      (r.cs_is_stattrak && r.cs_is_souvenir) || r.cs_is_stattrak !== (parsed.variant === 'STATTRAK') ||
      r.cs_is_souvenir !== (parsed.variant === 'SOUVENIR')) fail('VARIANT');
  const identity = membership(r.market_hash_name, r.cs_collection, r.cs_rarity);
  if (r.cs_wear !== identity.wear) fail('WEAR');
  const f = r.cs_paint_wear, [lo, hi] = wearBounds[wears.indexOf(identity.wear)];
  if (typeof f !== 'number' || !Number.isFinite(f) || f < identity.float_min || f > identity.float_max || f < lo || f >= hi) fail('FLOAT');
  const inspect_format = validateCsDealsInspect(r.cs_inspect_link, { assetId: r.steam_asset_id,
    exactFloat: f, paintIndex: r.cs_paint_index, paintSeed: r.cs_paint_seed });
  const created_at = stamp(r.created_at);
  if (Date.parse(created_at) > Date.parse(observed_at)) fail('FUTURE_LISTING');
  const trade_locked_until = r.trade_locked_until == null ? null : stamp(r.trade_locked_until);
  return Object.freeze({ ...source(), ...identity, ...money(r.price), source_listing_id: String(r.id),
    steam_asset_id: r.steam_asset_id, exact_float: f, inspect: r.cs_inspect_link, inspect_format,
    cs_collection: r.cs_collection, cs_rarity: r.cs_rarity, cs_wear: r.cs_wear,
    paint_index: integer(r.cs_paint_index) ? r.cs_paint_index : null,
    paint_seed: integer(r.cs_paint_seed) ? r.cs_paint_seed : null,
    created_at, trade_locked_until, trade_locked: trade_locked_until === null ? null : Date.parse(trade_locked_until) > Date.parse(observed_at),
    observed_at, source_timestamp: null, timestamp_basis: 'OBSERVED_ONLY_SOURCE_AGE_UNKNOWN',
    confidence_flags: Object.freeze(['PRICE_EXACT', 'FLOAT_EXACT', 'SOURCE_VALIDATING']) });
}

export function normalizeCsDealsListings(payload, { observedAt } = {}) {
  stamp(observedAt);
  if (!Array.isArray(payload?.listings) || payload.listings.length > 1000 ||
      !(payload.next_cursor === null || positive(payload.next_cursor))) fail('LISTING_PAGE');
  const seen = new Set(), listings = [], rejected = {};
  for (const r of payload.listings) {
    if (!positive(r?.id) || seen.has(r.id)) fail('LISTING_ID');
    seen.add(r.id);
    try { listings.push(normalizeCsDealsListing(r, { observedAt })); }
    catch (error) {
      const code = error.message.startsWith('CSDEALS_') ? error.message : 'CSDEALS_COLLECTION';
      rejected[code] = (rejected[code] ?? 0) + 1;
    }
  }
  return { listings, rejected, raw_count: payload.listings.length, next_cursor: payload.next_cursor,
    coverage: payload.next_cursor === null ? 'RECEIVED_PAGE_END' : 'BOUNDED_PREFIX_NOT_FULL_MARKET' };
}

export function normalizeCsDealsAverages(payload, { observedAt } = {}) {
  const observed_at = stamp(observedAt), generated_at = stamp(payload?.generated_at);
  if (payload.window_days !== 30 || Date.parse(generated_at) > Date.parse(observed_at) ||
      !Array.isArray(payload.averages) || payload.averages.length > 100000) fail('AVERAGE_WINDOW');
  const result = [], seen = new Set();
  for (const r of payload.averages) {
    if (r?.app_id !== 730) fail('AVERAGE_APP');
    if (!str(r.market_hash_name) || seen.has(r.market_hash_name)) fail('AVERAGE_ID');
    seen.add(r.market_hash_name);
    let identity;
    try { identity = historyIdentity(r.market_hash_name); } catch { continue; }
    if (!positive(r.average_price) || !positive(r.sales) || !positive(r.volume) || r.volume < r.sales) fail('AVERAGE_SAMPLE');
    result.push(Object.freeze({ ...source(), ...identity, ...money(r.average_price), sales: r.sales, volume: r.volume,
      window_days: 30, source_timestamp: generated_at, observed_at,
      exact_float: null, history_identity_basis: 'EXACT_NAME_CATALOG_NOT_FLOAT_COMP',
      confidence_flags: Object.freeze(['SALES_EXECUTED', 'SOURCE_VALIDATING']) }));
  }
  return result;
}

export function normalizeCsDealsSales(payload, { observedAt, marketHashName } = {}) {
  const observed_at = stamp(observedAt), identity = historyIdentity(marketHashName), m = payload?.metadata;
  if (!Array.isArray(payload?.sales) || payload.sales.length > 100 || !m || m.current_page !== 1 ||
      m.current_limit !== 100 || !integer(m.total_items) || !integer(m.total_pages) ||
      m.total_items < payload.sales.length || payload.sales.length !== Math.min(100, m.total_items) ||
      m.total_pages !== Math.ceil(m.total_items / 100)) fail('SALE_PAGE');
  let previous = Infinity;
  const sales = payload.sales.map(r => {
    if (r.app_id !== 730 || r.market_hash_name !== marketHashName || !positive(r.price) || !positive(r.amount)) fail('SALE_IDENTITY');
    const sold_at = stamp(r.sold_at), time = Date.parse(sold_at);
    if (time > Date.parse(observed_at) || time > previous) fail('SALE_TIME');
    previous = time;
    return Object.freeze({ ...source(), ...identity, ...money(r.price), amount: r.amount, sold_at,
      observed_at, source_timestamp: sold_at, exact_float: null, source_listing_id: null,
      confidence_flags: Object.freeze(['SALES_EXECUTED', 'SALE_SETTLEMENT_UNVERIFIED', 'SOURCE_VALIDATING']) });
  });
  // REST has no stable sale ID: equal tuples cannot prove distinct executions.
  const distinct = new Set(sales.map(r => JSON.stringify([r.sold_at, r.raw_price, r.amount]))).size;
  return Object.freeze({ ...source(), market_hash_name: marketHashName, sales: Object.freeze(sales), distinct_sample: distinct,
    observed_at, total_items: m.total_items, sample_scope: 'BOUNDED_NEWEST_PAGE_NOT_FULL_30D',
    complete_30d_window: false });
}

export function csdealsPatientResale(ask, average, sample, { now = Date.now() } = {}) {
  let blocker = null;
  const fresh = (v, cap) => { const age = (now - Date.parse(stamp(v))) / 1000; return age >= 0 && age <= cap; };
  try {
    if (!Number.isFinite(now) || !ask || !average || !sample) fail('EVIDENCE_REQUIRED');
    for (const r of [ask, average, ...sample.sales]) {
      const identity = membership(r.market_hash_name, r.collection_id, r.rarity);
      if (r.source !== 'CSDEALS' || r.source_status !== 'SOURCE_VALIDATING' || r.generation !== identity.generation ||
          r.variant !== identity.variant || r.market_hash_name !== ask.market_hash_name ||
          r.collection_id !== ask.collection_id || r.rarity !== ask.rarity || !r.identity_evidence ||
          !positive(r.raw_price) || r.price_usd !== r.raw_price / 100) fail('IDENTITY_OR_PRICE');
    }
    if (sample.source !== 'CSDEALS' || sample.market_hash_name !== ask.market_hash_name ||
        !Number.isFinite(ask.exact_float) || !str(ask.inspect) || !str(ask.source_listing_id)) fail('LISTING_EVIDENCE');
    const identity = membership(ask.market_hash_name, ask.collection_id, ask.rarity);
    const [lo, hi] = wearBounds[wears.indexOf(identity.wear)];
    if (ask.exact_float < identity.float_min || ask.exact_float > identity.float_max ||
        ask.exact_float < lo || ask.exact_float >= hi || ask.wear !== identity.wear ||
        !average.confidence_flags?.includes('SALES_EXECUTED') || sample.sales.length > 100) fail('EVIDENCE_INVALID');
    validateCsDealsInspect(ask.inspect, { assetId: ask.steam_asset_id, exactFloat: ask.exact_float,
      paintIndex: ask.paint_index, paintSeed: ask.paint_seed });
    for (const sale of sample.sales) {
      if (!positive(sale.amount) || !sale.confidence_flags?.includes('SALES_EXECUTED') ||
          Date.parse(stamp(sale.sold_at)) > now || !fresh(sale.observed_at, 180)) fail('SALE_EVIDENCE');
    }
    if (!fresh(ask.observed_at, 180) || !fresh(average.observed_at, 180) || !fresh(sample.observed_at, 180) ||
        !fresh(average.source_timestamp, 900)) fail('STALE');
    if (average.window_days !== 30 || !positive(average.sales) || !positive(average.volume) ||
        average.sales < 5 || average.volume < Math.max(5, average.sales)) fail('AVERAGE_SAMPLE');
    const end = Date.parse(average.source_timestamp), start = end - 30 * 86400000;
    const inWindow = sample.sales.filter(r => Date.parse(r.sold_at) >= start && Date.parse(r.sold_at) <= end);
    const distinct = new Set(inWindow.map(r => JSON.stringify([r.sold_at, r.raw_price, r.amount])));
    if (distinct.size < 3 || !inWindow.some(r => fresh(r.sold_at, 7 * 86400))) fail('SAMPLE_WINDOW');
  } catch (e) { blocker = e.message.startsWith('CSDEALS_') ? e.message : 'CSDEALS_EVIDENCE_INVALID'; }
  const usable = blocker === null;
  return Object.freeze({ ...source(), status: usable ? 'REFERENCE_ONLY' : 'BLOCKED', blocker,
    evidence_mode: 'PATIENT_RESALE', mode: 'PATIENT_RESALE', exit_venue: 'CSDEALS',
    market_hash_name: ask?.market_hash_name ?? null, variant: ask?.variant ?? null,
    collection_id: ask?.collection_id ?? null, generation: ask?.generation ?? null,
    source_listing_id: ask?.source_listing_id ?? null, exact_float: ask?.exact_float ?? null,
    raw_price: average?.raw_price ?? null, raw_price_unit: 'USD_CENTS', raw_currency: 'USD', normalized_currency: 'USD',
    fx_rate_used: 1, fx_timestamp: null, source_timestamp: average?.source_timestamp ?? null,
    age_seconds: usable ? (now - Date.parse(average.source_timestamp)) / 1000 : null,
    exit_reference_type: 'CSDEALS_EXECUTED_SALES_30D', exit_reference_usd: usable ? average.price_usd : null,
    balance_after_standard_percentage_fee_usd: usable ? Number(BigInt(average.raw_price) * 98n) / 10000 : null,
    buyer_fee_pct: 0, seller_fee_pct: 2, buyer_fee_fixed: null, seller_fee_fixed: null,
    deposit_fee_pct: null, withdrawal_fee_pct: null, withdrawal_fee_fixed: null,
    fee_status: 'FEES_PARTIAL', fee_evidence_date: '2026-10-09', fee_evidence_url: 'https://cs.deals/fees',
    acquisition_cost_usd: null, net_exit_usd: null, estimated_net_profit_usd: null, estimated_net_margin_pct: null,
    best_bid_usd: null, best_bid_qty: null, bid_executable: false, bid_depth: null, spread_pct: null,
    economic_action_score: null, action_tier: 'BLOCKED', liquidity_tier: null,
    recent_sale_median: null, recent_sale_p25: null, recent_sale_p75: null,
    history_exact_float: null, window_days: average?.window_days ?? null, sales_count: average?.sales ?? null,
    volume: average?.volume ?? null, sample_count: sample?.sales?.length ?? null, guards: CSDEALS_GUARDS,
    confidence_flags: Object.freeze(['SOURCE_VALIDATING', 'FEES_PARTIAL', ...(usable ? ['SALES_EXECUTED'] : [])]),
    friction: { trade_locked_until: ask?.trade_locked_until ?? null, cash_withdrawal_hold_days_approx: 7,
      exit_balance_type: 'CSDEALS_REUSABLE_BALANCE_REFERENCE', cash_out_fees: 'N_D', float_premium: 'N_D' } });
}

export function createCsDealsClient({ env = {}, fetcher = fetch, now = Date.now } = {}) {
  const next = new Map();
  async function get(path, params, interval) {
    if (env.CSDEALS_READ_ONLY_AUTHORIZED !== 'true' || !str(env.CSDEALS_API_KEY)) fail('AUTHORIZED_KEY_REQUIRED');
    if (now() < (next.get(path) ?? 0)) fail('BACKOFF');
    next.set(path, now() + interval);
    const url = new URL(path, 'https://api.cs.deals');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response;
    try { response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.CSDEALS_API_KEY}`, Accept: 'application/json' } }); }
    catch { fail('READ_UNAVAILABLE'); }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      next.set(path, now() + Math.max(interval, /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : 60000));
      await response.body?.cancel(); fail(`HTTP_${response.status}`);
    }
    // Never surface server bodies, fetch exceptions, headers or credentials.
    try {
      if (!response.body || Number(response.headers.get('content-length')) > 12000000) { await response.body?.cancel(); fail('BODY'); }
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > 12000000) { await reader.cancel(); fail('BODY'); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return { body, observedAt: new Date(now()).toISOString() };
    } catch { fail('RESPONSE_INVALID'); }
  }
  return Object.freeze({
    async listings({ cursor } = {}) {
      if (cursor !== undefined && !positive(cursor)) fail('CURSOR');
      return get('/public/v1/listings', { app_id: '730', limit: '500', ...(cursor ? { cursor } : {}) }, 1100);
    },
    async averages() { return get('/public/v1/sales/averages', { app_id: '730' }, 2100); },
    async sales(marketHashName) {
      historyIdentity(marketHashName);
      return get('/public/v1/sales', { app_id: '730', page: '1', limit: '100', market_hash_name: marketHashName }, 5100);
    }
  });
}
