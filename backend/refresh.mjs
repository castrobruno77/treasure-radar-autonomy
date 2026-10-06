import { randomUUID } from 'node:crypto';
import { collectScan } from './radar.mjs';
import { validateOpportunityPayload } from '../extension/api.js';

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
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random } = {}) {
  let inFlight = null;
  let stopped = true;
  let timer = null;
  async function attempt() {
    const owner = randomUUID();
    let acquired = false;
    try {
      const claim = await coordinator.claim(owner);
      if (claim.status !== 'ACQUIRED') return claim;
      acquired = true;
      const snapshot = await collect();
      const result = await coordinator.finish(owner, snapshot);
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
