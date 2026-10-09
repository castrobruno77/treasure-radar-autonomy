import { randomUUID } from 'node:crypto';
import { collectScan, SCAN_TELEMETRY, COLLECTOR_VERSION, COLLECTION, RARITY, REVISION } from './radar.mjs';
import { validateOpportunityPayload } from '../extension/api.js';
import { adaptiveScanPlan, WINDOW_MS, MAX_TELEMETRY_ROWS } from './adaptive-scan-plan.mjs';
import { pilotScanPlan } from './scan-plan.mjs';

export class RefreshCoordinator {
  constructor({ env = process.env, fetcher = fetch } = {}) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('REFRESH_CONFIG_REQUIRED');
    this.url = env.SUPABASE_URL.replace(/\/+$/, '');
    this.key = env.SUPABASE_SERVICE_ROLE_KEY;
    this.fetcher = fetcher;
  }
  async rpc(name, body) {
    const response = await this.fetcher(`${this.url}/rest/v1/rpc/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('REFRESH_STORAGE_UNAVAILABLE');
    const result = await response.json();
    if (!result || !['ACQUIRED','FRESH','COOLDOWN','BUDGET','HALTED','COMPLETE','LEASE_LOST','BACKOFF','BLOCKED'].includes(result.status)
      || !Number.isFinite(result.wait_ms) || result.wait_ms < 0) throw new Error('REFRESH_STORAGE_INVALID');
    return result;
  }
  claim(owner) { return this.rpc('tsr_refresh_claim', { p_owner: owner }); }
  async scanPlan(now = Date.now()) {
    // Server-only lightweight #40 rows, bounded to #33's daily attempt ceiling.
    // No snapshot bodies, new retention, grants, credentials or schema changes.
    const query = new URLSearchParams({ source: 'eq.DMarket',
      started_at: `gte.${new Date(now - WINDOW_MS).toISOString()}`,
      select: 'id,source,collection,rarity,variant_scope,started_at,finished_at,status,certified_count,candidate_count,economic_scored_count,actionable_count,rate_limit_hit,snapshot_age_at_start,collector_version',
      order: 'started_at.desc,id.asc', limit: String(MAX_TELEMETRY_ROWS) });
    const response = await this.fetcher(`${this.url}/rest/v1/tsr_run_telemetry?${query}`, {
      redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}` }
    });
    if (!response.ok) throw new Error('PLANNER_TELEMETRY_UNAVAILABLE');
    return adaptiveScanPlan({ budget: 10, telemetry: await response.json(), now })[0];
  }
  async snapshotAgeAtStart(now = Date.now()) {
    const response = await this.fetcher(`${this.url}/rest/v1/tsr_runs?status=eq.COMPLETE&select=snapshot&order=finished_at.desc&limit=1`, {
      redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}` }
    });
    if (!response.ok) throw new Error('TELEMETRY_SNAPSHOT_READ_UNAVAILABLE');
    const rows = await response.json();
    const generated = rows?.[0]?.snapshot?.generated_at;
    if (!generated) return null;
    const captured = Date.parse(generated);
    if (!Number.isFinite(captured) || captured > now + 5000) return null;
    return Math.max(0, Math.floor((now - captured) / 1000));
  }
  async recordTelemetry(event) {
    const response = await this.fetcher(`${this.url}/rest/v1/rpc/tsr_record_run_telemetry`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: event })
    });
    if (!response.ok) throw new Error('TELEMETRY_WRITE_UNAVAILABLE');
    const result = await response.json();
    if (result?.status !== 'RECORDED') throw new Error('TELEMETRY_WRITE_INVALID');
    return result;
  }
  async finish(owner, snapshot = null, { retrySeconds = 0, blocked = false } = {}) {
    if (snapshot) validateOpportunityPayload(snapshot);
    const result = await this.rpc('tsr_refresh_finish', {
      p_owner: owner, p_snapshot: snapshot, p_retry_seconds: retrySeconds, p_blocked: blocked
    });
    if (result.status === 'COMPLETE') {
      if (!/^[a-f0-9-]{36}$/.test(result.run_id || '')) throw new Error('REFRESH_READBACK_INVALID');
      const response = await this.fetcher(`${this.url}/rest/v1/tsr_runs?id=eq.${result.run_id}&select=id,status,snapshot&limit=1`, {
        redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}` }
      });
      if (!response.ok) throw new Error('REFRESH_READBACK_UNAVAILABLE');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== result.run_id || rows[0].status !== 'COMPLETE'
        || rows[0].snapshot?.generated_at !== snapshot?.generated_at) throw new Error('REFRESH_READBACK_INVALID');
      validateOpportunityPayload(rows[0].snapshot);
    }
    return result;
  }
}

export function createRefreshWorker({ coordinator, collect = collectScan, log = console.log,
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random, now = Date.now } = {}) {
  let inFlight = null;
  let stopped = true;
  let timer = null;

  async function record(event) {
    if (typeof coordinator.recordTelemetry !== 'function') return;
    try { await coordinator.recordTelemetry(event); }
    catch { log(JSON.stringify({ event: 'REMOTE_FEED_TELEMETRY', status: 'DROPPED' })); }
  }

  async function attempt() {
    const owner = randomUUID();
    let acquired = false;
    let startedMs = null;
    let snapshotAgeAtStart = null;
    try {
      // Check persisted history before consuming an attempt/lease. On restarts
      // the same history produces the same due time. The durable #33 claim is
      // still authoritative for budget, cooldown, backoff and HALTED state.
      if (typeof coordinator.scanPlan === 'function') {
        try {
          const plan = await coordinator.scanPlan(now());
          if (plan.wait_ms > 0) return { status: 'PLANNED_WAIT', wait_ms: plan.wait_ms };
        } catch { log(JSON.stringify({ event: 'REMOTE_FEED_PLANNER', status: 'STATIC_FALLBACK' })); }
      }
      const claim = await coordinator.claim(owner);
      if (claim.status !== 'ACQUIRED') return claim;
      acquired = true;
      startedMs = now();
      if (typeof coordinator.snapshotAgeAtStart === 'function') {
        try { snapshotAgeAtStart = await coordinator.snapshotAgeAtStart(startedMs); } catch { /* telemetry only */ }
      }
      const snapshot = await collect();
      const result = await coordinator.finish(owner, snapshot);
      const finishedMs = now();
      if (result.status === 'COMPLETE') {
        const m = snapshot[SCAN_TELEMETRY] ?? {};
        await record({
          run_id: result.run_id,
          source: m.source ?? snapshot.scope?.source ?? 'DMarket',
          collection: m.collection ?? snapshot.scope?.collection ?? null,
          rarity: m.rarity ?? snapshot.scope?.rarity ?? null,
          variant_scope: m.variant_scope ?? null,
          started_at: new Date(startedMs).toISOString(),
          finished_at: new Date(finishedMs).toISOString(),
          duration_ms: Math.max(0, finishedMs - startedMs),
          jobs_planned: m.jobs_planned ?? null,
          jobs_completed: m.jobs_completed ?? null,
          listing_count_seen: m.listing_count_seen ?? snapshot.items?.length ?? null,
          comparable_count: m.comparable_count ?? snapshot.items?.filter(x => Number.isInteger(x.peer_count) && x.peer_count > 0).length ?? null,
          candidate_count: m.candidate_count ?? snapshot.items?.length ?? null,
          certified_count: m.certified_count ?? snapshot.items?.filter(x => x.status === 'CERTIFIED').length ?? null,
          quality_scored_count: m.quality_scored_count ?? null,
          quality_score_avg: m.quality_score_avg ?? null,
          economic_scored_count: m.economic_scored_count ?? null,
          economic_score_avg: m.economic_score_avg ?? null,
          economic_blocked_count: m.economic_blocked_count ?? null,
          actionable_count: m.actionable_count ?? null,
          status: 'COMPLETE',
          error_code: null,
          retry_count: 0,
          rate_limit_hit: false,
          retry_after_seconds: null,
          snapshot_age_at_start: snapshotAgeAtStart,
          collector_version: m.collector_version ?? null,
          comparator_version: m.comparator_version ?? snapshot.comparator_version ?? null
        });
      }
      log(JSON.stringify({ event: 'REMOTE_FEED_REFRESH', status: result.status,
        ...(result.status === 'COMPLETE' ? { run_id: result.run_id, generated_at: snapshot.generated_at } : {}) }));
      return result;
    } catch (error) {
      // Shared backoff survives restart. A lost response/lease cannot release a newer owner.
      let result = { status: 'STORAGE_ERROR', wait_ms: 300000 };
      if (acquired) {
        try { result = await coordinator.finish(owner, null, {
          retrySeconds: Number.isInteger(error.retrySeconds) ? error.retrySeconds : 0,
          blocked: error.blocked === true
        }); } catch { /* Lease expires; cooldown still applies. */ }
        const finishedMs = now();
        const rawCode = typeof error?.message === 'string' ? error.message : '';
        const errorCode = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : 'COLLECTOR_ERROR';
        await record({
          run_id: null,
          source: 'DMarket',
          collection: COLLECTION,
          rarity: RARITY,
          variant_scope: pilotScanPlan().variants.join('|'),
          started_at: new Date(startedMs ?? finishedMs).toISOString(),
          finished_at: new Date(finishedMs).toISOString(),
          duration_ms: Math.max(0, finishedMs - (startedMs ?? finishedMs)),
          jobs_planned: null,
          jobs_completed: null,
          listing_count_seen: null,
          comparable_count: null,
          candidate_count: null,
          certified_count: null,
          status: 'ERROR',
          error_code: errorCode,
          retry_count: 0,
          rate_limit_hit: errorCode === 'SCAN_HTTP_429',
          retry_after_seconds: Number.isInteger(error.retrySeconds) ? error.retrySeconds : null,
          snapshot_age_at_start: snapshotAgeAtStart,
          collector_version: COLLECTOR_VERSION,
          comparator_version: REVISION
        });
      }
      log(JSON.stringify({ event: 'REMOTE_FEED_REFRESH', status: result.status }));
      return result;
    }
  }
  function tick() {
    if (inFlight) return inFlight;
    inFlight = attempt().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function loop() {
    const result = await tick();
    if (stopped) return;
    const delay = Math.min(300000, Math.max(30000, result.wait_ms)) + Math.floor(random()*5000);
    timer = setTimer(loop, delay);
    timer?.unref?.();
  }
  return {
    tick,
    start() { if (!stopped) return; stopped = false; void loop(); },
    stop() { stopped = true; if (timer) clearTimer(timer); }
  };
}
