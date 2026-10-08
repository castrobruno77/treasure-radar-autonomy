import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import { applyEconomicScoring } from './scoring.mjs';

export const DMARKET_ECONOMICS_VERSION = 'DMARKET_QUICK_EXIT_V1';
export const DMARKET_ORIGIN = 'https://api.dmarket.com';
export const DMARKET_GAME_ID = 'a8db';
export const DMARKET_BUYER_FEE_FRACTION = 0;
export const DMARKET_CONSERVATIVE_MAX_SELL_FEE_FRACTION = 0.10;
export const ECONOMIC_PAIRING_PREFERRED_SECONDS = 60;
export const ECONOMIC_PAIRING_HARD_CAP_SECONDS = 180;

const round2 = value => Math.round(value * 100) / 100;
const safeCode = value => /^[A-Z0-9_]{1,80}$/.test(value || '') ? value : 'DMARKET_ECONOMICS_UNAVAILABLE';

function privateKeyFromSecret(secretHex) {
  if (!/^[0-9a-f]{64}([0-9a-f]{64})?$/i.test(secretHex || '')) throw new Error('DMARKET_SECRET_KEY_INVALID');
  const seed = Buffer.from(secretHex.slice(0, 64), 'hex');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

export function signDmarketRequest({ method = 'GET', signRoute, timestamp, secretKey }) {
  const message = `${method}${signRoute}${timestamp}`;
  return nodeSign(null, Buffer.from(message), privateKeyFromSecret(secretKey)).toString('hex');
}

function queryString(entries) {
  const q = new URLSearchParams();
  for (const [key, value] of entries) if (value !== undefined && value !== null) q.append(key, String(value));
  return q.toString();
}

export function createDmarketClient({ env = process.env, fetcher = fetch, now = Date.now } = {}) {
  const publicKey = env.DMARKET_PUBLIC_KEY;
  const secretKey = env.DMARKET_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) throw new Error('DMARKET_PUBLIC_KEY_INVALID');
  privateKeyFromSecret(secretKey);

  async function get({ requestPath, signPath = requestPath, query = [] }) {
    const queryText = queryString(query);
    const requestRoute = `${requestPath}${queryText ? `?${queryText}` : ''}`;
    const signRoute = `${signPath}${queryText ? `?${queryText}` : ''}`;
    const timestamp = String(Math.floor(now() / 1000));
    const signature = signDmarketRequest({ method: 'GET', signRoute, timestamp, secretKey });
    const response = await fetcher(new URL(requestRoute, DMARKET_ORIGIN), {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': publicKey.toLowerCase(),
        'X-Sign-Date': timestamp,
        'X-Request-Sign': `dmar ed25519 ${signature}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const error = new Error(`DMARKET_ECONOMICS_HTTP_${response.status}`);
      if (response.status === 429) error.retrySeconds = 60;
      throw error;
    }
    return response.json();
  }

  return {
    async targetsByTitle(title) {
      const prefix = `/marketplace-api/v1/targets-by-title/${DMARKET_GAME_ID}/`;
      return get({ requestPath: prefix + encodeURIComponent(title), signPath: prefix + title });
    },
    async feeSchedule() {
      return get({ requestPath: '/exchange/v1/customized-fees', query: [
        ['gameId', DMARKET_GAME_ID], ['offerType', 'dmarket'], ['limit', 20], ['offset', 0]
      ] });
    },
    async lastSales(title) {
      return get({ requestPath: '/trade-aggregator/v1/last-sales', query: [
        ['gameId', DMARKET_GAME_ID], ['title', title], ['limit', 20], ['offset', 0]
      ] });
    }
  };
}

function isGenericTarget(order) {
  const attrs = order?.attributes ?? {};
  for (const key of ['floatPartValue', 'paintSeed', 'phase']) {
    const value = attrs[key];
    if (value !== undefined && value !== null && String(value).toLowerCase() !== 'any' && String(value) !== '') return false;
  }
  return true;
}

export function normalizeTargets(payload, title) {
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const normalized = orders
    .filter(order => order?.title === title && isGenericTarget(order))
    .map(order => ({
      price_cents: Number(order.price),
      amount: Number(order.amount)
    }))
    .filter(order => Number.isInteger(order.price_cents) && order.price_cents > 0 &&
      Number.isInteger(order.amount) && order.amount > 0)
    .sort((a, b) => b.price_cents - a.price_cents);
  if (!normalized.length) return null;
  const best = normalized[0].price_cents;
  return {
    best_bid_usd: round2(best / 100),
    best_bid_quantity: normalized.filter(x => x.price_cents === best).reduce((sum, x) => sum + x.amount, 0),
    depth_5pct_quantity: normalized.filter(x => x.price_cents >= Math.floor(best * 0.95)).reduce((sum, x) => sum + x.amount, 0),
    observed_levels: normalized.length
  };
}

export function conservativeFee(payload) {
  const fraction = Number(payload?.defaultFee?.fraction);
  const minAmount = Number(payload?.defaultFee?.minAmount);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 0.5) return null;
  if (!Number.isFinite(minAmount) || minAmount < 0) return null;

  // DMarket's public terms cap transaction fees at 10% of transaction value,
  // while the CS2 fee guide states sell fees normally range from 2% to 10%.
  // The customized-fees schema exposes minAmount without documenting its unit,
  // so we preserve it as raw evidence and do not convert or apply it.
  return {
    api_default_fraction: fraction,
    api_min_amount_raw: minAmount,
    api_min_amount_interpretation: 'UNSPECIFIED_NOT_USED',
    seller_fee_fraction: Math.max(fraction, DMARKET_CONSERVATIVE_MAX_SELL_FEE_FRACTION),
    buyer_fee_fraction: DMARKET_BUYER_FEE_FRACTION,
    basis: 'DMARKET_API_DEFAULT_PLUS_PUBLIC_CS2_MAX_10_PERCENT_2026_03',
    reduced_fee_ignored_conservatively: true
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round2((sorted[middle-1] + sorted[middle]) / 2);
}

export function normalizeSales(payload, observedMs) {
  const sales = Array.isArray(payload?.sales) ? payload.sales : [];
  const normalized = sales.map(x => ({
    price_usd: Number(x?.price),
    sold_at_ms: Number(x?.date) * 1000,
    mode: x?.txOperationType ?? null
  })).filter(x => Number.isFinite(x.price_usd) && x.price_usd > 0 &&
    Number.isFinite(x.sold_at_ms) && x.sold_at_ms > 0 && x.sold_at_ms <= observedMs + 300000);
  const latestMs = normalized.length ? Math.max(...normalized.map(x => x.sold_at_ms)) : null;
  return {
    sample_count: normalized.length,
    median_price_usd: median(normalized.map(x => x.price_usd)),
    latest_sale_at: latestMs ? new Date(latestMs).toISOString() : null,
    latest_sale_age_days: latestMs ? round2(Math.max(0, observedMs - latestMs) / 86400000) : null,
    target_sale_count: normalized.filter(x => x.mode === 'Target').length,
    offer_sale_count: normalized.filter(x => x.mode === 'Offer').length
  };
}

function blockedEvidence(code, extra = {}) {
  return {
    score: null,
    status: 'BLOCKED',
    mode: 'QUICK_EXIT',
    source: 'DMarket',
    version: DMARKET_ECONOMICS_VERSION,
    blocker: safeCode(code),
    ...extra
  };
}

export async function observeDmarketEconomics(item, { client, now = Date.now, feePromise } = {}) {
  const askCapturedMs = Date.parse(item?.captured_at);
  const startedMs = now();
  if (!Number.isFinite(askCapturedMs)) return blockedEvidence('ASK_TIMESTAMP_INVALID');
  if (Math.max(0, startedMs - askCapturedMs) > ECONOMIC_PAIRING_HARD_CAP_SECONDS * 1000) {
    return blockedEvidence('ECONOMIC_PAIRING_SKEW_EXCEEDED', {
      ask_captured_at: item.captured_at,
      skew_seconds: Math.floor((startedMs - askCapturedMs) / 1000)
    });
  }
  if (!client) return blockedEvidence('DMARKET_ECONOMICS_CREDENTIALS_UNAVAILABLE');

  try {
    const [targetsPayload, feePayload, salesPayload] = await Promise.all([
      client.targetsByTitle(item.market_hash_name),
      feePromise ?? client.feeSchedule(),
      client.lastSales(item.market_hash_name)
    ]);
    const observedMs = now();
    const skewSeconds = Math.max(0, Math.floor((observedMs - askCapturedMs) / 1000));
    if (skewSeconds > ECONOMIC_PAIRING_HARD_CAP_SECONDS) {
      return blockedEvidence('ECONOMIC_PAIRING_SKEW_EXCEEDED', {
        ask_captured_at: item.captured_at,
        economics_observed_at: new Date(observedMs).toISOString(),
        skew_seconds: skewSeconds
      });
    }

    const target = normalizeTargets(targetsPayload, item.market_hash_name);
    if (!target) return blockedEvidence('NO_EXECUTABLE_DMARKET_TARGET', {
      ask_usd: item.price_usd,
      ask_captured_at: item.captured_at,
      economics_observed_at: new Date(observedMs).toISOString(),
      skew_seconds: skewSeconds
    });
    const fees = conservativeFee(feePayload);
    if (!fees) return blockedEvidence('DMARKET_FEE_BASIS_UNRESOLVED', {
      ask_usd: item.price_usd,
      conservative_exit_usd: target.best_bid_usd,
      ask_captured_at: item.captured_at,
      economics_observed_at: new Date(observedMs).toISOString(),
      skew_seconds: skewSeconds
    });

    const history = normalizeSales(salesPayload, observedMs);
    const sellerFeeUsd = round2(target.best_bid_usd * fees.seller_fee_fraction);
    const netExitUsd = round2(target.best_bid_usd - sellerFeeUsd);
    const netProfitUsd = round2(netExitUsd - item.price_usd);
    const marginPct = round2((netProfitUsd / item.price_usd) * 100);
    const spreadPct = round2(((item.price_usd - target.best_bid_usd) / item.price_usd) * 100);

    return {
      status: 'COMPLETE',
      mode: 'QUICK_EXIT',
      source: 'DMarket',
      version: DMARKET_ECONOMICS_VERSION,
      ask_usd: item.price_usd,
      conservative_exit_usd: target.best_bid_usd,
      exit_venue: 'DMarket target',
      exit_balance_type: 'DMARKET_BALANCE',
      best_bid_quantity: target.best_bid_quantity,
      depth_5pct_quantity: target.depth_5pct_quantity,
      depth_status: target.observed_levels > 1 ? 'PARTIAL_LEVELS' : 'BEST_BID_ONLY',
      fee_basis: fees,
      seller_fee_usd: sellerFeeUsd,
      withdrawal_fee_status: 'N_D_NOT_INCLUDED',
      estimated_net_exit_usd: netExitUsd,
      estimated_net_profit_usd: netProfitUsd,
      estimated_margin_pct: marginPct,
      spread_pct: spreadPct,
      sales_history: history,
      ask_captured_at: item.captured_at,
      economics_observed_at: new Date(observedMs).toISOString(),
      skew_seconds: skewSeconds,
      skew_status: skewSeconds <= ECONOMIC_PAIRING_PREFERRED_SECONDS ? 'PREFERRED' : 'WITHIN_HARD_CAP',
      timestamp_basis: 'LIVE_ENDPOINT_CLIENT_CAPTURE',
      confidence: skewSeconds <= ECONOMIC_PAIRING_PREFERRED_SECONDS && history.sample_count >= 10 ? 'MEDIUM' : 'LOW',
      confidence_flags: ['TARGET_SOURCE_TIMESTAMP_UNAVAILABLE', 'WITHDRAWAL_FEE_NOT_INCLUDED']
    };
  } catch (error) {
    return blockedEvidence(safeCode(error?.message), {
      ask_usd: item?.price_usd ?? null,
      ask_captured_at: item?.captured_at ?? null
    });
  }
}

export async function enrichDmarketEconomics(snapshot, options = {}) {
  let client = null;
  try { client = createDmarketClient(options); }
  catch (error) {
    for (let i=0; i<snapshot.items.length; i++) {
      const item = snapshot.items[i];
      if (item.status === 'CERTIFIED' && Number.isFinite(item.quality_score)) {
        snapshot.items[i] = applyEconomicScoring(item, blockedEvidence(safeCode(error?.message)));
      }
    }
    return snapshot;
  }

  let feePromise = null;
  for (let i=0; i<snapshot.items.length; i++) {
    const item = snapshot.items[i];
    if (item.status !== 'CERTIFIED' || !Number.isFinite(item.quality_score)) continue;
    if (client && !feePromise) feePromise = client.feeSchedule();
    const evidence = await observeDmarketEconomics(item, { ...options, client, feePromise });
    snapshot.items[i] = applyEconomicScoring(item, evidence);
  }
  return snapshot;
}
