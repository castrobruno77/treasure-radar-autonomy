import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRemoteFeed, reportRemoteFeedPreparation } from '../backend/prepare-remote-feed.mjs';
import { SupabaseRunsStore } from '../backend/persistence.mjs';
import { createRemoteHandler } from '../backend/remote-handler.mjs';
import { collectScan, REVISION, COLLECTION, RARITY } from '../backend/radar.mjs';

const time = Date.parse('2026-10-05T20:00:00Z');
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  TSR_AUTH_ENABLED: 'true', TSR_PUBLIC_ORIGIN: 'https://radar.test',
  TSR_EXTENSION_ID: 'jlnahdgkmannagapaakmgbcahoholpmg' };
const snapshot = { status: 'OK', generated_at: new Date(time).toISOString(),
  comparator_version: REVISION, items: [] };
const token = 'offline-session-token';
const tokenHash = createHash('sha256').update(token).digest('base64url');

function database() {
  const state = { row: null, calls: [], session: { steam_id: '76561198000000001',
    issued_at: new Date(time - 1000).toISOString(), expires_at: new Date(time + 3600000).toISOString(), revoked_at: null } };
  state.fetcher = async (address, options) => {
    const url = new URL(address);
    state.calls.push({ url, options });
    if (url.pathname.endsWith('/tsr_sessions')) {
      return Response.json(url.searchParams.get('token_hash') === `eq.${tokenHash}` ? [state.session] : []);
    }
    assert.equal(url.pathname, '/rest/v1/tsr_runs');
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === 'POST') {
      state.row = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    }
    return Response.json(state.row ? [state.row] : []);
  };
  return state;
}
const unlocked = () => ({ lock: async () => async () => {} });
function request(bearer = token, origin = `chrome-extension://${env.TSR_EXTENSION_ID}`) {
  const headers = { origin };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('https://radar.test/v1/opportunities', { headers });
}

test('empty database reproduces authenticated 503; explicit bootstrap repairs it durably', async () => {
  const db = database();
  const handler = () => createRemoteHandler({ env, fetcher: db.fetcher, now: () => time,
    store: new SupabaseRunsStore({ url: env.SUPABASE_URL, serviceRoleKey: 'test-only', fetcher: db.fetcher }) });
  const before = await handler()(request());
  assert.equal(before.status, 503);
  assert.equal((await before.json()).error, 'NO_SUCCESSFUL_SCAN');
  let scans = 0;
  const options = { env, fetcher: db.fetcher, local: unlocked(), now: () => time,
    collect: async () => { scans++; return snapshot; } };
  assert.equal((await prepareRemoteFeed(options)).status, 'COMPLETE');
  const after = await handler()(request());
  assert.equal(after.status, 200);
  assert.equal((await after.json()).generated_at, snapshot.generated_at);
  assert.equal((await prepareRemoteFeed(options)).status, 'EXISTING_SNAPSHOT');
  assert.equal(scans, 1);
  assert.equal(db.calls.filter(c => c.options.method === 'POST').length, 1);
  assert.equal((await handler()(request(null))).status, 401);
  assert.equal((await handler()(request('invalid'))).status, 401);
  assert.equal((await handler()(request(token, 'https://attacker.test'))).status, 403);
  db.session.expires_at = new Date(time).toISOString();
  assert.equal((await handler()(request())).status, 401);
  db.session.expires_at = new Date(time + 3600000).toISOString();
  db.session.revoked_at = new Date(time - 1).toISOString();
  assert.equal((await handler()(request())).status, 401);
});

test('existing stale snapshot is not re-scanned or re-dated', async () => {
  const db = database();
  db.row = { snapshot };
  await prepareRemoteFeed({ env, fetcher: db.fetcher, local: unlocked(),
    collect: async () => assert.fail('must not scan'), now: () => time + 301000 });
  const handle = createRemoteHandler({ env, fetcher: db.fetcher, now: () => time + 301000,
    store: new SupabaseRunsStore({ url: env.SUPABASE_URL, serviceRoleKey: 'test-only', fetcher: db.fetcher }) });
  const body = await (await handle(request())).json();
  assert.equal(body.status, 'STALE');
  assert.equal(body.freshness_seconds, 301);
  assert.equal(body.generated_at, snapshot.generated_at);
});

test('missing configuration, database errors and invalid snapshots never trigger a scan', async () => {
  for (const mode of ['config', 'http', 'network', 'invalid', 'malformed']) {
    let released = false;
    await assert.rejects(prepareRemoteFeed({ env: mode === 'config' ? {} : env,
      local: { lock: async () => async () => { released = true; } },
      fetcher: async () => {
        if (mode === 'network') throw new Error('offline');
        if (mode === 'malformed') return Response.json({ unexpected: true });
        return mode === 'http' ? new Response(null, { status: 503 }) : Response.json([{ snapshot: {} }]);
      }, collect: async () => assert.fail('must not scan') }));
    assert.equal(released, mode !== 'config');
  }
});

test('partial scans and failed persistence/readback cannot report readiness; no retries', async () => {
  for (const mode of ['partial', 'insert', 'readback']) {
    const db = database();
    let scans = 0;
    let reads = 0;
    let writes = 0;
    const fetcher = async (url, options) => {
      if (options.method === 'POST') {
        writes++;
        if (mode === 'insert') return new Response(null, { status: 503 });
      } else if (++reads > 1 && mode === 'readback') return Response.json([]);
      return db.fetcher(url, options);
    };
    await assert.rejects(prepareRemoteFeed({ env, fetcher, local: unlocked(), now: () => time,
      collect: async () => {
        scans++;
        if (mode !== 'partial') return snapshot;
        return collectScan(async url => url.endsWith('/health')
          ? Response.json({ ok: true, revision: REVISION })
          : Response.json({ ops: 'OPS-045', mode: 'MINI_SCAN_ROBUST_COMPARATOR', status: 'PARTIAL',
            params: { source: 'DMarket', collection: COLLECTION, rarity: RARITY } }));
      } }));
    assert.equal(scans, 1);
    assert.equal(writes, mode === 'partial' ? 0 : 1);
  }
});

test('container lock prevents overlapping preparations and is released after completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsr-prepare-'));
  const db = database();
  let finish;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const options = { env: { ...env, TSR_DATA_DIR: directory }, fetcher: db.fetcher, now: () => time,
    collect: () => { entered(); return new Promise(resolve => { finish = () => resolve(snapshot); }); } };
  let pending;
  try {
    pending = prepareRemoteFeed(options);
    await started;
    await assert.rejects(prepareRemoteFeed(options), { code: 'EEXIST' });
    finish();
    await pending;
    assert.equal((await prepareRemoteFeed(options)).status, 'EXISTING_SNAPSHOT');
  } finally {
    if (finish) finish();
    if (pending) await pending;
    await rm(directory, { recursive: true, force: true });
  }
});

test('operational failure logs never contain raw exceptions or credentials', async () => {
  const logs = [];
  assert.equal(await reportRemoteFeedPreparation({ env, local: unlocked(),
    fetcher: async () => { throw new Error('secret-value'); } }, line => logs.push(line)), false);
  assert.deepEqual(logs.map(JSON.parse), [{ event: 'REMOTE_FEED_PREPARATION', status: 'FAILED' }]);
});
