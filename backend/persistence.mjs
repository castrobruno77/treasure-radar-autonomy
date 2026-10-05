import { randomUUID } from 'node:crypto';
import { validateOpportunityPayload } from '../extension/api.js';

function requireSnapshot(snapshot) {
  validateOpportunityPayload(snapshot);
  if (!Number.isFinite(Date.parse(snapshot.generated_at))) throw new Error('INVALID_SNAPSHOT');
  return snapshot;
}

function trimSlash(value) {
  return value.replace(/\/+$/, '');
}

export class SupabaseRunsStore {
  constructor({ url, serviceRoleKey, fetcher = fetch }) {
    if (!url || !serviceRoleKey) throw new Error('SUPABASE_RUNS_CONFIG_REQUIRED');
    this.url = trimSlash(url);
    this.serviceRoleKey = serviceRoleKey;
    this.fetcher = fetcher;
  }

  headers(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra
    };
  }

  async write(snapshot, { startedAt, finishedAt } = {}) {
    requireSnapshot(snapshot);
    const started = startedAt ?? snapshot.generated_at;
    const finished = finishedAt ?? snapshot.generated_at;
    if (!Number.isFinite(Date.parse(started)) || !Number.isFinite(Date.parse(finished)) ||
        Date.parse(finished) < Date.parse(started)) throw new Error('INVALID_RUN_TIME');

    const id = randomUUID();
    const row = {
      id,
      started_at: started,
      finished_at: finished,
      source: snapshot.scope?.source ?? 'DMarket',
      status: 'COMPLETE',
      comparator_version: snapshot.comparator_version,
      snapshot
    };

    const response = await this.fetcher(`${this.url}/rest/v1/tsr_runs`, {
      method: 'POST',
      redirect: 'error',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(row)
    });
    if (!response.ok) throw new Error(`TSR_RUNS_INSERT_${response.status}`);

    const readback = await this.fetcher(
      `${this.url}/rest/v1/tsr_runs?id=eq.${encodeURIComponent(id)}&select=id,status,snapshot&limit=1`,
      { method: 'GET', redirect: 'error', headers: this.headers() }
    );
    if (!readback.ok) throw new Error(`TSR_RUNS_READBACK_${readback.status}`);
    const rows = await readback.json();
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== id || rows[0]?.status !== 'COMPLETE') {
      throw new Error('TSR_RUNS_READBACK_MISMATCH');
    }
    requireSnapshot(rows[0].snapshot);
    return { id, persisted: true };
  }

  async read() {
    const response = await this.fetcher(
      `${this.url}/rest/v1/tsr_runs?status=eq.COMPLETE&select=id,finished_at,snapshot&order=finished_at.desc&limit=1`,
      { method: 'GET', redirect: 'error', headers: this.headers() }
    );
    if (!response.ok) throw new Error(`TSR_RUNS_SELECT_${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return requireSnapshot(rows[0].snapshot);
  }
}

export class ResilientRunStore {
  constructor({ local, remote = null }) {
    if (!local) throw new Error('LOCAL_STORE_REQUIRED');
    this.local = local;
    this.remote = remote;
  }

  async lock() {
    return this.local.lock();
  }

  async write(snapshot, metadata = {}) {
    await this.local.write(snapshot);
    if (!this.remote) return { local: true, remote: false, reason: 'REMOTE_NOT_CONFIGURED' };
    try {
      const result = await this.remote.write(snapshot, metadata);
      return { local: true, remote: true, remote_id: result.id };
    } catch (error) {
      return { local: true, remote: false, reason: error.message };
    }
  }

  async read() {
    if (this.remote) {
      try {
        const snapshot = await this.remote.read();
        if (snapshot) return snapshot;
      } catch {
        // Preserve the last known local snapshot; database reads never refresh its timestamps.
      }
    }
    return this.local.read();
  }
}

export function createSupabaseRunsStoreFromEnv(env = process.env, { fetcher = fetch } = {}) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return new SupabaseRunsStore({ url, serviceRoleKey, fetcher });
}
