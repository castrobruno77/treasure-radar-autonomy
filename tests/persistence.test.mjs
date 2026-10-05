import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRunsStore, ResilientRunStore } from '../backend/persistence.mjs';

const snapshot = {
  status: 'OK',
  generated_at: '2026-10-05T20:00:00.000Z',
  comparator_version: 'OPS045_ROBUST_COMPARATOR_V1',
  pilot_notice: 'test',
  scope: { source: 'DMarket', collection: 'The 2021 Mirage Collection', rarity: 'Consumer Grade' },
  items: []
};

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('SupabaseRunsStore persists bounded COMPLETE run metadata and verifies exact-ID readback', async () => {
  const calls = [];
  let inserted;
  const store = new SupabaseRunsStore({
    url: 'https://project.test',
    serviceRoleKey: 'server-only-test-key',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        inserted = JSON.parse(options.body);
        return response(null, 201);
      }
      return response([{ id: inserted.id, status: 'COMPLETE', snapshot: inserted.snapshot }]);
    }
  });
  const result = await store.write(snapshot, {
    startedAt: '2026-10-05T19:59:00.000Z',
    finishedAt: '2026-10-05T20:00:01.000Z'
  });
  assert.equal(result.persisted, true);
  assert.equal(inserted.source, 'DMarket');
  assert.equal(inserted.status, 'COMPLETE');
  assert.equal(inserted.comparator_version, snapshot.comparator_version);
  assert.equal(inserted.started_at, '2026-10-05T19:59:00.000Z');
  assert.equal(inserted.finished_at, '2026-10-05T20:00:01.000Z');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /id=eq\./);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-key');
});

test('SupabaseRunsStore reads only latest COMPLETE snapshot without changing freshness', async () => {
  const store = new SupabaseRunsStore({
    url: 'https://project.test/',
    serviceRoleKey: 'server-only-test-key',
    fetcher: async (url) => {
      assert.match(url, /status=eq\.COMPLETE/);
      assert.match(url, /order=finished_at\.desc/);
      return response([{ id: 'run-1', finished_at: '2026-10-05T20:01:00Z', snapshot }]);
    }
  });
  const loaded = await store.read();
  assert.equal(loaded.generated_at, snapshot.generated_at);
});

test('database write failure preserves local durable snapshot and reports fallback', async () => {
  let localSnapshot = null;
  const local = {
    async write(value) { localSnapshot = structuredClone(value); },
    async read() { return localSnapshot; },
    async lock() { return async () => {}; }
  };
  const remote = {
    async write() { throw new Error('TSR_RUNS_INSERT_503'); },
    async read() { throw new Error('TSR_RUNS_SELECT_503'); }
  };
  const store = new ResilientRunStore({ local, remote });
  const result = await store.write(snapshot, {
    startedAt: '2026-10-05T19:59:00Z',
    finishedAt: '2026-10-05T20:00:01Z'
  });
  assert.deepEqual(result, { local: true, remote: false, reason: 'TSR_RUNS_INSERT_503' });
  assert.equal((await store.read()).generated_at, snapshot.generated_at);
});

test('remote readback is preferred when valid; null or failure falls back locally', async () => {
  const localSnapshot = { ...snapshot, generated_at: '2026-10-05T19:00:00.000Z' };
  const remoteSnapshot = { ...snapshot, generated_at: '2026-10-05T20:00:00.000Z' };
  const local = {
    async write() {},
    async read() { return localSnapshot; },
    async lock() { return async () => {}; }
  };

  const remoteOk = new ResilientRunStore({ local, remote: { async read() { return remoteSnapshot; } } });
  assert.equal((await remoteOk.read()).generated_at, remoteSnapshot.generated_at);

  const remoteNull = new ResilientRunStore({ local, remote: { async read() { return null; } } });
  assert.equal((await remoteNull.read()).generated_at, localSnapshot.generated_at);

  const remoteFail = new ResilientRunStore({ local, remote: { async read() { throw new Error('db down'); } } });
  assert.equal((await remoteFail.read()).generated_at, localSnapshot.generated_at);
});
