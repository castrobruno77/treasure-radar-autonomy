import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshWorker, RefreshCoordinator } from '../backend/refresh.mjs';
import { normalizeScan, COLLECTION, RARITY, REVISION, SCAN_TELEMETRY } from '../backend/radar.mjs';

function rawScan() {
  return {
    ops: 'OPS-045', mode: 'MINI_SCAN_ROBUST_COMPARATOR', status: 'PASS',
    params: { source: 'DMarket', collection: COLLECTION, rarity: RARITY },
    jobs: { planned: 10, completed: 10, error: 0 }, errors: [],
    freshness: { captured_at: '2026-10-07T00:00:00.000Z' },
    opportunities: [
      { offer_id: 'a', skin: 'A', variant: 'NORMAL', wear: 'Factory New', float: 0.01, normalized_float: 0.01,
        price_usd: 1, timestamp: '2026-10-06T23:59:59.000Z', classification: 'CERTIFIED_SURVIVOR',
        listing_link: 'https://dmarket.com/ingame-items/item-list/csgo-skins?test=a',
        robust_comparator: { rule: 'CHEAPEST_EQUAL_OR_BETTER_NORMALIZED_FLOAT', peer_count: 4, gap_pct: 20, cheapest_price_usd: 1.25 } },
      { offer_id: 'b', skin: 'B', variant: 'SOUVENIR', wear: 'Factory New', float: 0.02, normalized_float: 0.02,
        price_usd: 1.5, timestamp: '2026-10-06T23:59:59.000Z', classification: 'INSUFFICIENT_EVIDENCE',
        robust_comparator: { rule: 'CHEAPEST_EQUAL_OR_BETTER_NORMALIZED_FLOAT', peer_count: 0, gap_pct: null, cheapest_price_usd: null } }
    ]
  };
}

test('scan telemetry is observable internally but never serialized into feed snapshot', () => {
  const snapshot = normalizeScan(rawScan(), Date.parse('2026-10-07T00:00:01Z'));
  assert.equal(snapshot[SCAN_TELEMETRY].jobs_planned, 10);
  assert.equal(snapshot[SCAN_TELEMETRY].candidate_count, 2);
  assert.equal(snapshot[SCAN_TELEMETRY].certified_count, 1);
  assert.equal(snapshot[SCAN_TELEMETRY].quality_scored_count, 1);
  assert.equal(snapshot[SCAN_TELEMETRY].economic_scored_count, 0);
  assert.equal(snapshot[SCAN_TELEMETRY].economic_blocked_count, 1);
  assert.equal(snapshot[SCAN_TELEMETRY].actionable_count, 0);
  assert.equal(snapshot[SCAN_TELEMETRY].variant_scope, 'NORMAL|SOUVENIR');
  assert.equal(JSON.parse(JSON.stringify(snapshot)).SCAN_TELEMETRY, undefined);
  assert.ok(!JSON.stringify(snapshot).includes('jobs_planned'));
});

test('successful refresh records bounded dimensions and counts without changing core result', async () => {
  const snapshot = normalizeScan(rawScan(), Date.parse('2026-10-07T00:00:01Z'));
  const events = [];
  let clock = Date.parse('2026-10-07T00:00:02Z');
  const worker = createRefreshWorker({
    coordinator: {
      claim: async () => ({ status: 'ACQUIRED', wait_ms: 240000 }),
      snapshotAgeAtStart: async () => 245,
      finish: async () => ({ status: 'COMPLETE', wait_ms: 240000, run_id: '00000000-0000-4000-a000-000000000040' }),
      recordTelemetry: async e => { events.push(e); return { status: 'RECORDED' }; }
    },
    collect: async () => snapshot,
    now: () => (clock += 25),
    log: () => {}
  });
  const result = await worker.tick();
  assert.equal(result.status, 'COMPLETE');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'DMarket');
  assert.equal(events[0].collection, COLLECTION);
  assert.equal(events[0].rarity, RARITY);
  assert.equal(events[0].candidate_count, 2);
  assert.equal(events[0].certified_count, 1);
  assert.equal(events[0].quality_scored_count, 1);
  assert.ok(Number.isFinite(events[0].quality_score_avg));
  assert.equal(events[0].economic_scored_count, 0);
  assert.equal(events[0].economic_score_avg, null);
  assert.equal(events[0].economic_blocked_count, 1);
  assert.equal(events[0].actionable_count, 0);
  assert.equal(events[0].snapshot_age_at_start, 245);
  assert.equal(events[0].status, 'COMPLETE');
});

test('telemetry write failure is non-blocking and never changes COMPLETE refresh outcome', async () => {
  const snapshot = normalizeScan(rawScan(), Date.parse('2026-10-07T00:00:01Z'));
  const logs = [];
  const worker = createRefreshWorker({
    coordinator: {
      claim: async () => ({ status: 'ACQUIRED', wait_ms: 240000 }),
      finish: async () => ({ status: 'COMPLETE', wait_ms: 240000, run_id: '00000000-0000-4000-a000-000000000041' }),
      recordTelemetry: async () => { throw new Error('db telemetry down'); }
    },
    collect: async () => snapshot,
    now: () => Date.parse('2026-10-07T00:00:02Z'),
    log: line => logs.push(JSON.parse(line))
  });
  assert.equal((await worker.tick()).status, 'COMPLETE');
  assert.ok(logs.some(x => x.event === 'REMOTE_FEED_TELEMETRY' && x.status === 'DROPPED'));
});

test('rate-limit failure records safe error telemetry while preserving shared backoff result', async () => {
  const events = [];
  const error = Object.assign(new Error('SCAN_HTTP_429'), { retrySeconds: 900 });
  const worker = createRefreshWorker({
    coordinator: {
      claim: async () => ({ status: 'ACQUIRED', wait_ms: 240000 }),
      snapshotAgeAtStart: async () => 300,
      finish: async () => ({ status: 'BACKOFF', wait_ms: 900000 }),
      recordTelemetry: async e => { events.push(e); return { status: 'RECORDED' }; }
    },
    collect: async () => { throw error; },
    now: () => Date.parse('2026-10-07T00:00:02Z'),
    log: () => {}
  });
  assert.equal((await worker.tick()).status, 'BACKOFF');
  assert.equal(events[0].status, 'ERROR');
  assert.equal(events[0].error_code, 'SCAN_HTTP_429');
  assert.equal(events[0].rate_limit_hit, true);
  assert.equal(events[0].retry_after_seconds, 900);
  assert.equal(events[0].collection, COLLECTION);
  assert.equal(events[0].rarity, RARITY);
  assert.equal(events[0].collector_version, 'TREASURE_RADAR_DMARKET_V1');
  assert.equal(events[0].comparator_version, REVISION);
});

test('coordinator telemetry endpoints stay server-only and validate recorded response', async () => {
  const calls = [];
  const coordinator = new RefreshCoordinator({
    env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'server-key' },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('tsr_runs?')) {
        return Response.json([{ snapshot: { generated_at: '2026-10-07T00:00:00Z' } }]);
      }
      return Response.json({ status: 'RECORDED', id: '00000000-0000-4000-a000-000000000099' });
    }
  });
  assert.equal(await coordinator.snapshotAgeAtStart(Date.parse('2026-10-07T00:05:00Z')), 300);
  assert.equal((await coordinator.recordTelemetry({ status: 'COMPLETE' })).status, 'RECORDED');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer server-key');
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_event: { status: 'COMPLETE' } });
});
