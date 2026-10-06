import { createSupabaseRunsStoreFromEnv } from './persistence.mjs';
import { FileStore } from './store.mjs';
import { collectScan } from './radar.mjs';

// Explicit, one-shot cold-start preparation. Never called by a feed request.
// One replica only: the local lock coordinates collectors in this container.
export async function prepareRemoteFeed({
  env = process.env, fetcher = fetch, collect = collectScan, now = Date.now,
  local = new FileStore(env.TSR_DATA_DIR || '.data')
} = {}) {
  const remote = createSupabaseRunsStoreFromEnv(env, { fetcher });
  if (!remote) throw new Error('SUPABASE_RUNS_CONFIG_REQUIRED');
  const release = await local.lock();
  try {
    // An unavailable/invalid database is not an empty database. Do not scan then.
    // Existing timestamps, including stale snapshots, must remain unchanged.
    if (await remote.read()) return { status: 'EXISTING_SNAPSHOT' };
    const startedAt = new Date(now()).toISOString();
    const snapshot = await collect(fetcher);
    const finishedAt = new Date(now()).toISOString();
    // Strict remote persistence: local-only success cannot repair the remote feed.
    await remote.write(snapshot, { startedAt, finishedAt });
    return { status: 'COMPLETE', generated_at: snapshot.generated_at };
  } finally {
    await release();
  }
}

export async function reportRemoteFeedPreparation(options, log = console.log) {
  try {
    const result = await prepareRemoteFeed(options);
    log(JSON.stringify({ event: 'REMOTE_FEED_PREPARATION', ...result }));
    return true;
  } catch {
    // No credentials, upstream bodies, session tokens or raw exceptions in logs.
    log(JSON.stringify({ event: 'REMOTE_FEED_PREPARATION', status: 'FAILED' }));
    return false;
  }
}
