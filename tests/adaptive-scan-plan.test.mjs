import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveScanPlan, TELEMETRY_SCOPE_VERSION, MAX_TELEMETRY_ROWS } from '../backend/adaptive-scan-plan.mjs';
import { PILOT_CAPABILITY } from '../backend/collection-registry.mjs';
import { planScans } from '../backend/scan-plan.mjs';
import { RefreshCoordinator, createRefreshWorker } from '../backend/refresh.mjs';
import { normalizeScan, SCAN_TELEMETRY, REVISION } from '../backend/radar.mjs';

const now = Date.parse('2026-10-08T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
function history(overrides = {}, n = 6) {
  return Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, source: 'DMarket',
    collection: 'The 2021 Mirage Collection', rarity: 'Consumer Grade', variant_scope: 'NORMAL|SOUVENIR',
    collector_version: TELEMETRY_SCOPE_VERSION, status: 'COMPLETE',
    started_at: iso(now - (i * 5 + 1) * 60000), finished_at: iso(now - i * 5 * 60000),
    certified_count: 2, candidate_count: 10, economic_scored_count: 8, actionable_count: 1,
    rate_limit_hit: false, snapshot_age_at_start: 240, ...overrides }));
}
const plan = telemetry => adaptiveScanPlan({ budget: 10, telemetry, now })[0];

test('meaningful recent yield promotes; measured stale-heavy yield uses slower hot target', () => {
  const p = plan(history());
  assert.equal(p.reason, 'RECENT_ACTIONABLE_YIELD');
  assert.equal(p.interval_seconds, 300);
  assert.equal(p.metrics.certified_yield, 0.2);
  assert.equal(p.metrics.economic_coverage, 0.8);
  assert.equal(p.metrics.actionable_yield, 0.1);
  assert.equal(p.collection_priority_tier, 'P0');
  assert.equal(p.jobs, 10);
  assert.equal(plan(history({ snapshot_age_at_start: 301 })).interval_seconds, 600);
  assert.equal(plan(history({ snapshot_age_at_start: null })).interval_seconds, 600);
});

test('cold/no-signal and error/rate pressure demote before any promotion', () => {
  const cold = plan(history({ certified_count: 0, actionable_count: 0 }));
  assert.equal(cold.reason, 'NO_SIGNAL_STREAK');
  assert.equal(cold.interval_seconds, 1800);
  assert.equal(cold.metrics.no_signal_streak, 6);
  for (const change of [{ rate_limit_hit: true }, { status: 'ERROR' }]) {
    const rows = history(); Object.assign(rows[0], change);
    assert.equal(plan(rows).reason, 'RATE_OR_ERROR_PRESSURE');
    assert.equal(plan(rows).interval_seconds, 1800);
  }
});

test('sample/window guards: tiny, burst, duplicate, expired, future and legacy records cannot adapt', () => {
  for (const rows of [[], history({}, 5), history().map(r => ({ ...r, started_at: iso(now - 60000) })),
    Array(6).fill(history()[0]), history({ started_at: iso(now - 86400001) }),
    history({ finished_at: iso(now + 1) }), history({ collector_version: 'TREASURE_RADAR_DMARKET_V3_REGISTRY' })]) {
    assert.equal(plan(rows).reason, 'STATIC_INSUFFICIENT_TELEMETRY');
    assert.equal(plan(rows).interval_seconds, 240);
  }
  for (const overrides of [{ economic_scored_count: null }, { actionable_count: null },
    { certified_count: null }, { candidate_count: 1 }, { actionable_count: 0 }]) {
    assert.notEqual(plan(history(overrides)).reason, 'RECENT_ACTIONABLE_YIELD');
  }
  const concentrated = history({ certified_count: 0, actionable_count: 0 });
  Object.assign(concentrated[0], { certified_count: 20, actionable_count: 6 });
  assert.notEqual(plan(concentrated).reason, 'RECENT_ACTIONABLE_YIELD');
  const old = history().map(r => ({ ...r, started_at: iso(Date.parse(r.started_at) - 7200000),
    finished_at: iso(Date.parse(r.finished_at) - 7200000) }));
  assert.notEqual(plan(old).reason, 'RECENT_ACTIONABLE_YIELD');
  assert.throws(() => plan(Array(MAX_TELEMETRY_ROWS + 1).fill({})), /INVALID_PLANNER_INPUT/);
});

test('deterministic scope isolation preserves generations, rarity, source and exact variant set', () => {
  for (const overrides of [{ collection: 'The Mirage Collection' }, { collection: '2021 Vertigo' },
    { rarity: 'Industrial Grade' }, { source: 'Waxpeer' }, { variant_scope: 'NORMAL' },
    { variant_scope: 'SOUVENIR' }, { variant_scope: 'STATTRAK' }, { variant_scope: null }]) {
    assert.equal(plan(history(overrides)).metrics.scans, 0);
  }
  assert.deepEqual(plan(history().reverse()), plan(history()));
  assert.equal(plan(history({ collection: 'Mirage 2021' })).reason, 'RECENT_ACTIONABLE_YIELD');
  const train = { ...PILOT_CAPABILITY, collection: 'train-2021' };
  const result = adaptiveScanPlan({ budget: 10, capabilities: [train], now,
    telemetry: history({ collection: 'Train' }) });
  assert.equal(result[0].metrics.scans, 0);
  const variants = adaptiveScanPlan({ budget: 10, capabilities: [{ ...PILOT_CAPABILITY, variants: ['NORMAL'] }],
    now, telemetry: history() });
  assert.equal(variants[0].metrics.scans, 0);
});

test('tier floors stay 60/30/10; bounded P1/P2 cadence and oldest due scope gets remainder fairly', () => {
  const capabilities = ['mirage-2021', 'ancient', 'assault', 'control'].map(collection => ({ ...PILOT_CAPABILITY, collection }));
  const telemetry = capabilities.flatMap((s, i) => history({ collection: s.collection }).map(r => ({ ...r, id: `${i}-${r.id}` })));
  const result = adaptiveScanPlan({ budget: 100, capabilities, telemetry, now });
  assert.throws(() => adaptiveScanPlan({ budget: 1, capabilities, telemetry, now }), /CANNOT_SERVE_ENABLED_TIERS/);
  assert.deepEqual(adaptiveScanPlan({ budget: 0, capabilities, telemetry, now }), []);
  assert.deepEqual(['P0', 'P1', 'P2'].map(t => result.filter(r => r.collection_priority_tier === t).reduce((s, r) => s + r.jobs, 0)), [60, 30, 10]);
  assert.equal(result.find(r => r.collection_id === 'assault').interval_seconds, 1800);
  assert.equal(result.find(r => r.collection_id === 'control').interval_seconds, 7200);
  const cold = adaptiveScanPlan({ budget: 100, capabilities, now, telemetry: telemetry.map(r => ({ ...r, certified_count: 0, actionable_count: 0 })) });
  assert.equal(cold.find(r => r.collection_id === 'assault').interval_seconds, 3600);
  assert.equal(cold.find(r => r.collection_id === 'control').interval_seconds, 21600);
  const pair = capabilities.slice(0, 2);
  let rows = [];
  const served = [];
  for (let i = 0; i < 4; i++) {
    const [next] = adaptiveScanPlan({ budget: 1, capabilities: pair, telemetry: rows, now: now + i * 300000 });
    served.push(next.collection_id);
    rows.push({ ...history()[0], id: `served-${i}`, collection: next.collection,
      started_at: iso(now + i * 300000), finished_at: iso(now + i * 300000) });
  }
  assert.deepEqual(served, ['ancient', 'mirage-2021', 'ancient', 'mirage-2021']);
  assert.deepEqual(planScans({ budget: 10 }), adaptiveScanPlan({ budget: 10, now }).map(({ source, collection, collection_id, generation, collection_priority_tier, rarity, variants, jobs }) =>
    ({ source, collection, collection_id, generation, collection_priority_tier, rarity, variants, jobs })));
});

test('stored #40 telemetry read is bounded, server-only and consumed by the real worker across restart', async () => {
  const calls = [];
  const coordinator = new RefreshCoordinator({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only' },
    fetcher: async (url, options) => {
      const u = new URL(url); calls.push(u);
      assert.equal(options.headers.Authorization, 'Bearer server-only');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(u.searchParams.get('limit'), '360');
      assert.equal(u.searchParams.get('source'), 'eq.DMarket');
      assert.equal(u.searchParams.get('started_at'), `gte.${iso(now - 86400000)}`);
      assert.ok(!u.searchParams.get('select').split(',').includes('snapshot'));
      return Response.json(history());
    } });
  coordinator.claim = () => assert.fail('must wait without consuming an attempt');
  for (let i = 0; i < 2; i++) {
    const worker = createRefreshWorker({ coordinator, now: () => now, log: () => {}, collect: () => assert.fail('not due') });
    assert.deepEqual(await worker.tick(), { status: 'PLANNED_WAIT', wait_ms: 300000 });
  }
  assert.equal(calls.length, 2);
});

test('planner failures fall back to static; due plans cannot bypass durable gates', async () => {
  for (const status of ['BUDGET', 'HALTED', 'COOLDOWN', 'BACKOFF', 'FRESH']) {
    for (const scanPlan of [async () => ({ wait_ms: 0 }), async () => { throw new Error('private-db-detail'); }]) {
      const logs = [];
      const worker = createRefreshWorker({ coordinator: { scanPlan, claim: async () => ({ status, wait_ms: 900000 }) },
        collect: () => assert.fail('gated'), log: s => logs.push(s) });
      assert.equal((await worker.tick()).status, status);
      assert.ok(!logs.join('').includes('private-db-detail'));
    }
  }
  for (const response of [Response.json({}), Response.json([]), new Response(null, { status: 503 })]) {
    const c = new RefreshCoordinator({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' }, fetcher: async () => response });
    let scans = 0;
    c.claim = async () => ({ status: 'ACQUIRED', wait_ms: 240000 });
    c.finish = async () => ({ status: 'COMPLETE', wait_ms: 240000 });
    c.snapshotAgeAtStart = async () => null; c.recordTelemetry = async () => {};
    const worker = createRefreshWorker({ coordinator: c, now: () => now, log: () => {},
      collect: async () => { scans++; return { generated_at: iso(now), items: [] }; } });
    assert.equal((await worker.tick()).status, 'COMPLETE');
    assert.equal(scans, 1);
  }
});

test('empty scan records planned variants so repeated no-signal is evidence, not guessed coverage', () => {
  const s = normalizeScan({ ops: 'OPS-045', mode: 'MINI_SCAN_ROBUST_COMPARATOR', status: 'PASS',
    params: { source: 'DMarket', collection: 'Mirage 2021', rarity: 'Consumer Grade' },
    jobs: { planned: 10, completed: 10, error: 0 }, errors: [],
    freshness: { captured_at: iso(now) }, opportunities: [] }, now);
  assert.equal(s[SCAN_TELEMETRY].variant_scope, 'NORMAL|SOUVENIR');
  assert.equal(s[SCAN_TELEMETRY].collector_version, TELEMETRY_SCOPE_VERSION);
  assert.equal(s[SCAN_TELEMETRY].certified_count, 0);
  assert.equal(s.comparator_version, REVISION);
  assert.ok(!JSON.stringify(s).includes('variant_scope'));
});

test('worker-produced empty-run telemetry round-trips through storage into cold cadence', async () => {
  const stored = [];
  let clock = now - 25 * 60000;
  const coordinator = new RefreshCoordinator({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' },
    fetcher: async (url, options) => {
      if (url.includes('/rpc/tsr_record_run_telemetry')) {
        stored.push({ ...JSON.parse(options.body).p_event, id: `persisted-${stored.length}` });
        return Response.json({ status: 'RECORDED' });
      }
      assert.ok(url.includes('/tsr_run_telemetry?'));
      return Response.json(stored);
    } });
  coordinator.claim = async () => ({ status: 'ACQUIRED', wait_ms: 240000 });
  coordinator.finish = async () => ({ status: 'COMPLETE', wait_ms: 240000, run_id: '00000000-0000-4000-a000-000000000055' });
  coordinator.snapshotAgeAtStart = async () => 301;
  const worker = createRefreshWorker({ coordinator, now: () => clock, log: () => {},
    collect: async () => normalizeScan({ ops: 'OPS-045', mode: 'MINI_SCAN_ROBUST_COMPARATOR', status: 'PASS',
      params: { source: 'DMarket', collection: 'Mirage 2021', rarity: 'Consumer Grade' },
      jobs: { planned: 10, completed: 10, error: 0 }, errors: [], opportunities: [],
      freshness: { captured_at: iso(clock) } }, clock) });
  for (let i = 0; i < 6; i++) {
    assert.equal((await worker.tick()).status, 'COMPLETE'); clock += 300000;
  }
  assert.equal(stored.length, 6);
  const result = await coordinator.scanPlan(clock);
  assert.equal(result.reason, 'NO_SIGNAL_STREAK');
  assert.equal(result.interval_seconds, 1800);
  assert.equal(result.wait_ms, 1500000);
  assert.equal((await worker.tick()).status, 'PLANNED_WAIT');
  assert.equal(stored.length, 6);
});
