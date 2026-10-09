import { resolveCollection, RARITY_SCOPE } from './collection-registry.mjs';

export const WAXPEER_ORIGIN = 'https://api.waxpeer.com';
export const WAXPEER_VERSION = 'WAXPEER_READONLY_REFERENCE_V1';
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 100000;
const FLAGS = ['SOURCE_VALIDATING', 'BID_DEPTH_PARTIAL', 'FEES_PARTIAL'];
const fail = code => { throw new Error(`WAXPEER_${code}`); };
const text = (v, code) => typeof v === 'string' && v.length > 0 && v.length <= 2048 && v === v.trim() ? v : fail(code);
const id = v => text(v, 'INVALID_ID');
function integer(v) {
  if (!(typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) fail('INVALID_PRICE');
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) fail('INVALID_PRICE');
  return n;
}
export const waxpeerUsd = raw => integer(raw) / 1000;
const stamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) fail('INVALID_TIMESTAMP');
  const result = new Date(value).toISOString();
  if (result.slice(0, 19) !== value.slice(0, 19)) fail('INVALID_TIMESTAMP');
  return result;
};
const optional = v => v === '' || v === undefined || v === null ? null : text(v, 'INVALID_METADATA');
const optionalStamp = v => optional(v) === null ? null : stamp(v);

export function waxpeerVariant(name) {
  text(name, 'INVALID_NAME');
  const variant = name.startsWith('Souvenir ') ? 'SOUVENIR' : /^(?:★ )?StatTrak™ /.test(name) ? 'STATTRAK' : 'NORMAL';
  const bare = name.replace(/^Souvenir |^(?:★ )?StatTrak™ /, '');
  if (/^(?:★ )?(?:Souvenir|StatTrak)/i.test(bare)) fail('AMBIGUOUS_VARIANT');
  return variant;
}

// The registry resolves collection aliases; it is NOT an item membership catalog.
// Only an explicit, evidence-backed item mapping may attach a collection/rarity.
export function createWaxpeerCatalog(entries = []) {
  if (!Array.isArray(entries) || entries.length > MAX_ROWS) fail('INVALID_CATALOG');
  const map = new Map();
  for (const e of entries) {
    const name = text(e.market_hash_name, 'INVALID_NAME');
    const variant = waxpeerVariant(name);
    if (variant !== e.variant || !RARITY_SCOPE.includes(e.rarity)) fail('INVALID_CATALOG_SCOPE');
    const c = resolveCollection(e.collection);
    const evidence = Object.freeze({ reference: text(e.evidence?.reference, 'CATALOG_EVIDENCE_REQUIRED'),
      observed_at: stamp(e.evidence?.observed_at) });
    if (map.has(name)) fail('AMBIGUOUS_CATALOG_NAME');
    map.set(name, Object.freeze({ collection_id: c.id, collection: c.name, generation: c.generation,
      collection_priority_tier: c.collection_priority_tier, rarity: e.rarity, variant, identity_evidence: evidence }));
  }
  return name => map.get(name) ?? null;
}

function identity(name, catalog) {
  return { market_hash_name: text(name, 'INVALID_NAME'), variant: waxpeerVariant(name),
    collection_id: null, collection: null, generation: null, rarity: null,
    identity_evidence: null, ...catalog(name) };
}
function currency(raw) {
  return { raw_price: integer(raw), raw_currency: 'USD', normalized_currency: 'USD',
    raw_price_unit: 'USD_THOUSANDTHS', price_usd: waxpeerUsd(raw), fx_rate_used: 1, fx_timestamp: null };
}

// Strict RFC4180 subset with quoted commas/newlines/doubled quotes. Header names
// make append-only source columns safe; malformed/truncated rows fail the batch.
function csvRows(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > MAX_SNAPSHOT_BYTES) fail('SNAPSHOT_TOO_LARGE');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const cell = () => { row.push(field); field = ''; closed = false; };
  const end = () => { cell(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) fail('TOO_MANY_ROWS'); };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      if (c === ',') cell(); else { end(); if (c === '\r' && csv[i + 1] === '\n') i++; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') fail('INVALID_CSV'); field += c; }
  }
  if (quoted) fail('INVALID_CSV');
  if (field || closed || row.length) end();
  const header = rows.shift();
  if (!header || new Set(header).size !== header.length ||
      !['item_id', 'name', 'price', 'auto', 'inspect'].every(k => header.includes(k))) fail('INVALID_CSV_HEADER');
  return rows.map(values => {
    if (values.length !== header.length) fail('INVALID_CSV_ROW');
    return Object.fromEntries(header.map((k, i) => [k, values[i]]));
  });
}

export function normalizeWaxpeerListings(csv, { observedAt, catalog = createWaxpeerCatalog() } = {}) {
  const observed_at = stamp(observedAt);
  const seen = new Set();
  return csvRows(csv).map(r => {
    const item_id = id(r.item_id);
    if (seen.has(item_id)) fail('DUPLICATE_LISTING_ID');
    seen.add(item_id);
    const auto = r.auto === '' ? null : r.auto === 'true' ? true : r.auto === 'false' ? false : fail('INVALID_AUTO');
    const delivery = optional(r.delivery);
    if (delivery !== null && !['hold', 'instant', 'regular', 'manual'].includes(delivery)) fail('INVALID_DELIVERY');
    const unlock_at = optionalStamp(r.unlock_at), send_until = optionalStamp(r.send_until);
    if ((unlock_at && send_until && Date.parse(send_until) < Date.parse(unlock_at)) ||
        (delivery === 'hold' && !unlock_at)) fail('INVALID_LOCK');
    return Object.freeze({ source: 'WAXPEER', source_status: 'SOURCE_VALIDATING', source_listing_id: item_id, item_id,
      ...identity(r.name, catalog), ...currency(r.price), inspect: optional(r.inspect),
      auto, delivery, unlock_at, send_until, trade_locked: unlock_at ? true : null,
      class_id: optional(r.class_id), instance_id: optional(r.instance_id),
      exact_float: null, exact_float_status: 'N_D_AUTHORIZED_SOURCE_REQUIRED',
      source_timestamp: null, observed_at, timestamp_basis: 'INGESTION_ONLY_SOURCE_AGE_UNKNOWN',
      confidence_flags: Object.freeze(['PRICE_EXACT', 'SOURCE_VALIDATING']) });
  });
}

export function normalizeWaxpeerBids(payload, { observedAt, catalog = createWaxpeerCatalog() } = {}) {
  const observed_at = stamp(observedAt);
  if (payload?.success !== true || !Array.isArray(payload.offers) || payload.offers.length > MAX_ROWS) fail('INVALID_BID_SNAPSHOT');
  if (!Number.isSafeInteger(payload.timestamp) || payload.timestamp <= 0 || payload.timestamp > 253402300799) fail('INVALID_TIMESTAMP');
  const source_timestamp = new Date(payload.timestamp * 1000).toISOString();
  if (Date.parse(source_timestamp) > Date.parse(observed_at)) fail('FUTURE_TIMESTAMP');
  const seen = new Set();
  return payload.offers.map(r => {
    const name = text(r.name, 'INVALID_NAME');
    if (seen.has(name)) fail('DUPLICATE_BID_NAME');
    seen.add(name);
    return Object.freeze({ source: 'WAXPEER', source_status: 'SOURCE_VALIDATING',
      ...identity(name, catalog), ...currency(r.max), buyer_id: optional(r.by),
      best_bid_usd: waxpeerUsd(r.max), best_bid_qty: null,
      bid_depth_2pct: null, bid_depth_5pct: null, bid_depth_10pct: null,
      bid_depth_status: 'BID_DEPTH_PARTIAL', bid_executable: false,
      source_timestamp, observed_at, timestamp_basis: 'SOURCE_SNAPSHOT',
      confidence_flags: Object.freeze(['PRICE_EXACT', 'BID_DEPTH_PARTIAL', 'SOURCE_VALIDATING']) });
  });
}

export function waxpeerTiming(ask, bid, now) {
  try {
    if (!Number.isFinite(now)) fail('INVALID_TIMESTAMP');
    const askObserved = Date.parse(stamp(ask.observed_at ?? ask.captured_at));
    const bidObserved = Date.parse(stamp(bid.observed_at));
    const a = ask.source_timestamp ? Date.parse(stamp(ask.source_timestamp)) : askObserved;
    const b = Date.parse(stamp(bid.source_timestamp));
    if (Math.max(a, b, askObserved, bidObserved) > now || a > askObserved || b > bidObserved) fail('INVALID_TIMESTAMP');
    const skew_seconds = Math.abs(a - b) / 1000;
    const age_seconds = Math.max(now - a, now - b) / 1000;
    return { status: Math.max(skew_seconds, age_seconds) > 180 ? 'BLOCKED' :
      Math.max(skew_seconds, age_seconds) <= 60 ? 'PREFERRED' : 'WITHIN_HARD_CAP', skew_seconds, age_seconds,
      ask_timestamp_basis: ask.source_timestamp ? 'SOURCE_SNAPSHOT' : 'OBSERVED_ONLY_SOURCE_AGE_UNKNOWN' };
  } catch { return { status: 'BLOCKED', skew_seconds: null, age_seconds: null, ask_timestamp_basis: 'INVALID' }; }
}

function comparable(ask, bid) {
  try {
    const a = resolveCollection(ask.collection_id), b = resolveCollection(bid.collection_id);
    return a.id === b.id && ask.generation === a.generation && bid.generation === b.generation &&
      ask.market_hash_name === bid.market_hash_name && ask.variant === bid.variant &&
      ask.variant === waxpeerVariant(ask.market_hash_name) && ask.rarity === bid.rarity &&
      RARITY_SCOPE.includes(ask.rarity) && !!ask.identity_evidence && !!bid.identity_evidence;
  } catch { return false; }
}

export function waxpeerCrossCheck(ask, bid, { now = Date.now() } = {}) {
  const timing = waxpeerTiming(ask ?? {}, bid ?? {}, now);
  const validIdentity = comparable(ask ?? {}, bid ?? {});
  const usable = validIdentity && timing.status !== 'BLOCKED' && bid?.source === 'WAXPEER' &&
    Number.isFinite(ask.price_usd) && ask.price_usd > 0 &&
    Number.isSafeInteger(bid.raw_price) && bid.raw_price > 0 && bid.price_usd === bid.raw_price / 1000;
  return Object.freeze({ source: 'WAXPEER', version: WAXPEER_VERSION, source_status: 'SOURCE_VALIDATING',
    status: usable ? 'REFERENCE_ONLY' : 'BLOCKED', blocker: usable ? 'EXECUTION_AND_FEES_UNVALIDATED' :
      !validIdentity ? 'IDENTITY_UNRESOLVED_OR_MISMATCH' : 'TIMING_OR_PRICE_INVALID',
    evidence_mode: 'QUICK_EXIT', mode: 'QUICK_EXIT_REFERENCE',
    source_listing_id: ask?.source_listing_id ?? null, market_hash_name: ask?.market_hash_name ?? null,
    variant: ask?.variant ?? null, collection_id: ask?.collection_id ?? null,
    exact_float: ask?.exact_float ?? null, raw_price: bid?.raw_price ?? null, raw_price_unit: 'USD_THOUSANDTHS',
    raw_currency: 'USD', normalized_currency: 'USD', fx_rate_used: 1, fx_timestamp: null,
    exit_reference_type: 'WAXPEER_BEST_BUY_ORDER_REFERENCE', exit_venue: 'WAXPEER',
    best_bid_usd: usable ? bid.price_usd : null, best_bid_qty: null,
    exit_reference_usd: usable ? bid.price_usd : null,
    bid_depth_2pct: null, bid_depth_5pct: null, bid_depth_10pct: null,
    bid_depth_status: 'BID_DEPTH_PARTIAL', bid_executable: false,
    seller_fee_pct: 6, seller_fee_fixed: null, buyer_fee_pct: null, buyer_fee_fixed: null,
    deposit_fee_pct: null, withdrawal_fee_pct: null, withdrawal_fee_fixed: null,
    fee_status: 'FEES_PARTIAL', fee_evidence_date: '2026-10-08', fee_evidence_url: 'https://faq.waxpeer.com/faq/fees-sell',
    // Integer mills * 94 / 100000; reference after the percentage fee only.
    // Unknown fixed/funding/cash-out fees never become zero or certified net.
    balance_after_standard_percentage_fee_usd: usable ? Number(BigInt(bid.raw_price) * 94n) / 100000 : null,
    net_exit_usd: null, acquisition_cost_usd: null, estimated_net_profit_usd: null, estimated_net_margin_pct: null,
    exit_balance_type: 'WAXPEER_REUSABLE_BALANCE_REFERENCE', cash_withdrawal_hold_days_approx: 7,
    spread_pct: usable ? (ask.price_usd - bid.price_usd) / ask.price_usd * 100 : null,
    liquidity_tier: null, recent_sale_median: null, recent_sale_p25: null, recent_sale_p75: null, sale_count_window: null,
    economic_action_score: null, action_tier: 'BLOCKED',
    confidence_flags: Object.freeze([...FLAGS, ...(usable ? ['TIMESTAMPS_ALIGNED'] : [])]),
    timing, age_seconds: timing.age_seconds, skew_seconds: timing.skew_seconds,
    ask_observed_at: ask?.observed_at ?? ask?.captured_at ?? null,
    source_timestamp: bid?.source_timestamp ?? null, bid_observed_at: bid?.observed_at ?? null,
    friction: Object.freeze({ unlock_at: ask?.unlock_at ?? null, send_until: ask?.send_until ?? null,
      delivery: ask?.delivery ?? null, phase_or_float_targeting: 'NOT_PROVEN', cash_out_fees: 'N_D' }) });
}

// Attach no score and mutate no opportunity: #38 paths remain separate. A trusted
// catalog mapping must agree with the validated ask's explicit scope before join.
export function crossCheckWaxpeerOpportunity(item, bids, { catalog = createWaxpeerCatalog(), now = Date.now() } = {}) {
  let scope = null;
  try {
    const found = catalog(item.market_hash_name);
    if (found && item.source === 'DMarket' && resolveCollection(item.collection_id).id === found.collection_id &&
        resolveCollection(item.collection).id === found.collection_id && item.rarity === found.rarity &&
        (item.generation === undefined || item.generation === found.generation) &&
        item.is_souvenir === (found.variant === 'SOUVENIR') && item.is_stattrak === (found.variant === 'STATTRAK')) scope = found;
  } catch { /* Unresolved identity must block the economic reference. */ }
  const ask = { ...item, collection_id: null, generation: null, identity_evidence: null, ...scope,
    source_listing_id: item.offer_id ?? null, observed_at: item.captured_at, source_timestamp: item.captured_at };
  const bid = bids.find(b => b.market_hash_name === item.market_hash_name);
  return waxpeerCrossCheck(ask, bid, { now });
}

async function boundedBody(response, listingPrefix = false) {
  if (!listingPrefix && Number(response.headers.get('content-length')) > MAX_SNAPSHOT_BYTES) { await response.body?.cancel(); fail('SNAPSHOT_TOO_LARGE'); }
  if (!response.body) fail('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0, lines = 0, quoted = false;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      if (listingPrefix) {
        // Byte-level CSV boundaries are safe across UTF-8 chunks: delimiters are
        // ASCII, and doubled quotes toggle twice. Never cut inside a quoted name.
        for (let i = 0; i < value.length; i++) {
          if (value[i] === 34) quoted = !quoted;
          if (value[i] === 10 && !quoted && ++lines === 1001) {
            bytes += i + 1;
            if (bytes > MAX_SNAPSHOT_BYTES) { await reader.cancel(); fail('SNAPSHOT_TOO_LARGE'); }
            chunks.push(Buffer.from(value.subarray(0, i + 1)));
            await reader.cancel();
            return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), partial: true };
          }
        }
      }
      bytes += value.byteLength;
      if (bytes > MAX_SNAPSHOT_BYTES) { await reader.cancel(); fail('SNAPSHOT_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), partial: false };
  } finally { reader.releaseLock(); }
}

export function createWaxpeerClient({ fetcher = fetch, now = Date.now, env = {} } = {}) {
  let retryAt = 0;
  async function get(path, params, json = true) {
    if (now() < retryAt) throw Object.assign(new Error('WAXPEER_BACKOFF'), { retryAt });
    const url = new URL(path, WAXPEER_ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response;
    try { response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: json ? 'application/json' : 'text/csv' } }); }
    catch { fail('READ_UNAVAILABLE'); } // Never expose an authenticated URL/key via errors.
    if (!response.ok) {
      const raw = response.headers.get('retry-after');
      const delay = /^\d+$/.test(raw ?? '') ? Number(raw) * 1000 : Date.parse(raw) - now();
      retryAt = now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
      await response.body?.cancel();
      throw Object.assign(new Error(`WAXPEER_HTTP_${response.status}`), { retryAt });
    }
    let body, partial;
    try { const raw = await boundedBody(response, !json); body = json ? JSON.parse(raw.text) : raw.text; partial = raw.partial; }
    catch (error) { if (error.message === 'WAXPEER_SNAPSHOT_TOO_LARGE') throw error; fail('INVALID_RESPONSE'); }
    if (json && body?.success !== true) fail('SOURCE_ERROR');
    return { body, partial, observedAt: new Date(now()).toISOString() };
  }
  return Object.freeze({
    async publicSnapshots({ catalog = createWaxpeerCatalog() } = {}) {
      const listing = await get('/v1/prices/snapshot', { game: 'csgo', format: 'csv', include_hold: '1', include_manual: '1' }, false);
      const listings = normalizeWaxpeerListings(listing.body, { observedAt: listing.observedAt, catalog });
      const bid = await get('/v1/buy-orders/snapshot', { game: 'csgo' });
      const bids = normalizeWaxpeerBids(bid.body, { observedAt: bid.observedAt, catalog });
      const byName = new Map(bids.map(b => [b.market_hash_name, b]));
      return { source: 'WAXPEER', source_status: 'SOURCE_VALIDATING', version: WAXPEER_VERSION,
        listing_coverage: listing.partial ? 'BOUNDED_PREFIX_NOT_FULL_SNAPSHOT' : 'RECEIVED_SNAPSHOT',
        listings, bids, exact_float_status: 'N_D_NOT_REQUESTED',
        cross_checks: listings.map(ask => waxpeerCrossCheck(ask, byName.get(ask.market_hash_name), { now: now() })) };
    },
    async exactFloat(listing) {
      const unavailable = reason => ({ exact_float: null, status: 'N_D', reason, source_timestamp: null });
      if (env.WAXPEER_EXACT_FLOAT_AUTHORIZED !== 'true') return unavailable('NOT_AUTHORIZED');
      if (typeof env.WAXPEER_API_KEY !== 'string' || !env.WAXPEER_API_KEY.trim()) return unavailable('KEY_NOT_CONFIGURED');
      try {
        if (listing?.source !== 'WAXPEER') fail('FLOAT_SOURCE_MISMATCH');
        const title = text(listing.market_hash_name, 'INVALID_NAME'), itemId = id(listing.item_id);
        let cursor = null;
        const seen = new Set();
        for (let page = 0; page < 3; page++) {
          const params = { api: env.WAXPEER_API_KEY, game: 'csgo', search: title, limit: '100', include_hold: '1', ...(cursor ? { cursor } : {}) };
          const { body, observedAt } = await get('/v2/get-items-list', params);
          if (!Array.isArray(body.items) || body.items.length > 100) fail('INVALID_FLOAT_PAGE');
          const matches = body.items.filter(r => r.item_id === itemId);
          if (matches.length > 1) fail('DUPLICATE_FLOAT_ID');
          const r = matches[0];
          if (r) {
            if (r.name !== title || integer(r.price) !== listing.raw_price || typeof r.float !== 'number' ||
                !Number.isFinite(r.float) || r.float < 0 || r.float > 1) fail('FLOAT_JOIN_MISMATCH');
            if (Date.parse(observedAt) - Date.parse(stamp(listing.observed_at)) > 180000 ||
                Date.parse(observedAt) < Date.parse(listing.observed_at)) fail('FLOAT_JOIN_STALE');
            return { status: 'FLOAT_EXACT', exact_float: r.float, source_listing_id: itemId,
              market_hash_name: title, observed_at: observedAt, source_timestamp: null,
              timestamp_basis: 'AUTHORIZED_ENDPOINT_INGESTION_ONLY', source_endpoint: '/v2/get-items-list' };
          }
          if (body.has_more === false) return unavailable('ITEM_NOT_OBSERVED');
          if (body.has_more !== true || !body.next_cursor || seen.has(body.next_cursor)) fail('INVALID_FLOAT_CURSOR');
          cursor = text(body.next_cursor, 'INVALID_FLOAT_CURSOR'); seen.add(cursor);
        }
        return unavailable('PAGE_BUDGET_EXHAUSTED');
      } catch { return unavailable('AUTHORIZED_FLOAT_UNAVAILABLE'); }
    }
  });
}
