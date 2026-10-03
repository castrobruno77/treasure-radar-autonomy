export const LEGACY_ORIGIN = 'https://scale-radar.scale-cs2.deno.net';
export const REVISION = 'OPS045_ROBUST_COMPARATOR_V1';
export const COLLECTION = 'The 2021 Mirage Collection';
export const RARITY = 'Consumer Grade';
const statuses = { CERTIFIED_SURVIVOR: 'CERTIFIED', REJECTED_BY_COMPARATOR: 'REJECTED', INSUFFICIENT_EVIDENCE: 'INSUFFICIENT' };

// Translate evidence, never recalculate or relax the approved economic rule.
export function normalizeScan(scan, now = Date.now()) {
  if (scan?.ops !== 'OPS-045' || scan.mode !== 'MINI_SCAN_ROBUST_COMPARATOR' ||
      scan.status !== 'PASS' || scan.params?.source !== 'DMarket' ||
      scan.params.collection !== COLLECTION || scan.params.rarity !== RARITY ||
      scan.jobs?.planned !== 10 || scan.jobs.completed !== 10 || scan.jobs.error !== 0 ||
      !Array.isArray(scan.errors) || scan.errors.length || !Array.isArray(scan.opportunities)) {
    throw new Error('INCOMPLETE_OR_UNSUPPORTED_SCAN');
  }
  const generated = Date.parse(scan.freshness?.captured_at);
  if (!Number.isFinite(generated) || generated > now + 5000) throw new Error('INVALID_SCAN_TIME');
  const ids = new Set();
  const items = scan.opportunities.map(x => {
    const status = statuses[x.classification];
    const captured = Date.parse(x.timestamp);
    const r = x.robust_comparator;
    if (!status || typeof x.offer_id !== 'string' || !x.offer_id || ids.has(x.offer_id) ||
        typeof x.skin !== 'string' || !x.skin || !['NORMAL', 'SOUVENIR'].includes(x.variant) ||
        !Number.isFinite(x.price_usd) || x.price_usd <= 0 ||
        !Number.isFinite(x.float) || x.float < 0 || x.float > 1 ||
        !Number.isFinite(x.normalized_float) || x.normalized_float < 0 || x.normalized_float > 1 ||
        !Number.isFinite(captured) || captured > generated || generated - captured > 100000 ||
        r?.rule !== 'CHEAPEST_EQUAL_OR_BETTER_NORMALIZED_FLOAT' ||
        !Number.isInteger(r.peer_count) || r.peer_count < 0) throw new Error('INVALID_SCAN_ITEM');
    if (status === 'CERTIFIED' && (r.peer_count < 4 || !Number.isFinite(r.gap_pct) || r.gap_pct < 15 ||
        !Number.isFinite(r.cheapest_price_usd) || r.cheapest_price_usd <= x.price_usd)) {
      throw new Error('INVALID_CERTIFICATION');
    }
    ids.add(x.offer_id);
    let listing = null;
    try {
      const u = new URL(x.listing_link);
      if (u.protocol === 'https:' && ['dmarket.com', 'www.dmarket.com'].includes(u.hostname) && !u.username && !u.password) listing = u.href;
    } catch { /* Missing deep links are not fabricated. */ }
    return {
      id: `dmarket:${x.offer_id}`, source: 'DMarket', collection: COLLECTION, rarity: RARITY,
      market_hash_name: `${x.variant === 'SOUVENIR' ? 'Souvenir ' : ''}${x.skin}${x.wear ? ` (${x.wear})` : ''}`,
      is_souvenir: x.variant === 'SOUVENIR', is_stattrak: false, wear: x.wear ?? null,
      float_value: x.float, normalized_float: x.normalized_float, price_usd: x.price_usd,
      comparable_price_usd: r.cheapest_price_usd, robust_gap_pct: r.gap_pct,
      peer_count: r.peer_count, offer_id: x.offer_id, listing_url: listing,
      captured_at: x.timestamp, status
    };
  });
  return { status: 'OK', generated_at: scan.freshness.captured_at, comparator_version: REVISION,
    pilot_notice: 'Piloto: sinal do comparador legado; elegibilidade para trade-up ainda não revalidada.',
    scope: { source: 'DMarket', collection: COLLECTION, rarity: RARITY }, items };
}

export async function collectScan(fetcher = fetch) {
  const health = await fetcher(`${LEGACY_ORIGIN}/health`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  const h = await health.json();
  if (!health.ok || !h.ok || h.revision !== REVISION) throw new Error('UPSTREAM_REVISION_GATE');
  const u = new URL('/rare-scan', LEGACY_ORIGIN);
  for (const [k, v] of Object.entries({ source: 'DMarket', collection: COLLECTION, rarity: RARITY,
    max_jobs: 10, concurrency: 2, timeout_ms: 12000, deadline_ms: 85000 })) u.searchParams.set(k, v);
  const response = await fetcher(u, { signal: AbortSignal.timeout(95000), redirect: 'error' });
  if (!response.ok) throw new Error(`SCAN_HTTP_${response.status}`);
  return normalizeScan(await response.json());
}
