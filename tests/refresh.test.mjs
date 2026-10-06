import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshCoordinator, createRefreshWorker } from '../backend/refresh.mjs';
import { collectScan, upstreamFailure, REVISION, COLLECTION, RARITY } from '../backend/radar.mjs';
import { createHandler } from '../backend/handler.mjs';

const snapshot = { status: 'OK', generated_at: '2026-10-06T00:00:00.000Z',
  comparator_version: REVISION, items: [], scope: { source: 'DMarket', collection: COLLECTION, rarity: RARITY } };
const done = { status: 'COMPLETE', wait_ms: 240000, run_id: '00000000-0000-4000-a000-000000000001' };
const acquired = { status: 'ACQUIRED', wait_ms: 240000 };
const noLog = () => {};

test('timer repeats after TTL without overlapping or catch-up burst; shutdown stops future work', async () => {
  let scans = 0;
  let released;
  let releaseSignal;
  const entered = new Promise(resolve => { releaseSignal = resolve; });
  const scheduled = [];
  const cleared = [];
  const worker = createRefreshWorker({
    coordinator: { claim: async () => acquired, finish: async () => done },
    collect: async () => { scans++; releaseSignal(); await new Promise(resolve => { released = resolve; }); return snapshot; },
    log: noLog, random: () => 0,
    setTimer: (fn, delay) => { const t = { fn, delay }; scheduled.push(t); return t; },
    clearTimer: t => cleared.push(t)
  });
  worker.start();
  worker.start();
  await entered;
  const tick1 = worker.tick();
  const tick2 = worker.tick();
  assert.equal(tick1, tick2);
  assert.equal(scans, 1);
  assert.equal(scheduled.length, 0);
  released();
  await tick1;
  await Promise.resolve();
  assert.equal(scheduled[0].delay, 240000);
  const second = scheduled[0].fn();
  await Promise.resolve();
  assert.equal(scans, 2);
  worker.stop();
  released();
  await second;
  assert.equal(scheduled.length, 1);
  assert.equal(cleared.length, 1);
});

test('fresh, cooldown, budget, and halted coordinator results never scan or publish', async () => {
  for (const status of ['FRESH','COOLDOWN','BUDGET','HALTED']) {
    const worker = createRefreshWorker({ coordinator: {
      claim: async () => ({ status, wait_ms: 240000 }), finish: () => assert.fail('must not publish')
    }, collect: () => assert.fail('must not scan'), log: noLog });
    assert.equal((await worker.tick()).status, status);
  }
});

test('database unavailable fails closed, does not scan, uses bounded local retry', async () => {
  const logs = [];
  const worker = createRefreshWorker({ coordinator: { claim: async () => { throw new Error('secret'); } },
    collect: () => assert.fail('must not scan'), log: line => logs.push(line) });
  assert.deepEqual(await worker.tick(), { status: 'STORAGE_ERROR', wait_ms: 300000 });
  assert.ok(!logs.join('').includes('secret'));
});

test('429, partial scans and persistence failures preserve last good snapshot and share backoff', async () => {
  for (const kind of ['rate','partial','write']) {
    let persisted = snapshot;
    let failures = 0;
    let scans = 0;
    const worker = createRefreshWorker({ coordinator: {
      claim: async () => acquired,
      finish: async (owner, candidate, policy) => {
        assert.match(owner, /^[a-f0-9-]{36}$/);
        if (candidate) throw new Error('write failed');
        failures++;
        assert.equal(policy.retrySeconds, kind === 'rate' ? 1200 : 0);
        return { status: 'BACKOFF', wait_ms: 1200000 };
      }
    }, collect: async () => {
      scans++;
      if (kind === 'rate') throw upstreamFailure(new Response(null,{status:429,headers:{'retry-after':'1200'}}));
      if (kind === 'partial') return collectScan(async url => url.endsWith('/health')
        ? Response.json({ ok:true, revision:REVISION }) : Response.json({ status:'PARTIAL' }));
      return { ...snapshot, generated_at: '2026-10-06T00:05:01.000Z' };
    }, log: noLog });
    assert.equal((await worker.tick()).status, 'BACKOFF');
    assert.equal(scans, 1);
    assert.equal(failures, 1);
    const response = await createHandler({ read: async () => persisted },
      { now: () => Date.parse(snapshot.generated_at)+301000 })(new Request('http://test/v1/opportunities'));
    const body = await response.json();
    assert.equal(body.status, 'STALE');
    assert.equal(body.generated_at, snapshot.generated_at);
  }
});

test('upstream HTTP Retry-After seconds/dates honored; forbidden and revision gates halt', async () => {
  assert.equal(upstreamFailure(new Response(null,{status:429})).retrySeconds,900);
  assert.equal(upstreamFailure(new Response(null,{status:503,headers:{'retry-after':'86401'}})).retrySeconds,86401);
  const time = Date.parse('2026-10-06T00:00:00Z');
  assert.equal(upstreamFailure(new Response(null,{status:429,headers:{'retry-after':'Tue, 06 Oct 2026 01:00:00 GMT'}}),time).retrySeconds,3600);
  for(const status of [401,403]) {
    await assert.rejects(collectScan(async()=>new Response(null,{status})), e=>e.blocked===true);
  }
  await assert.rejects(collectScan(async()=>Response.json({ok:true,revision:'other'})), e=>e.blocked===true);
  let policy;
  const worker = createRefreshWorker({ coordinator: { claim: async()=>acquired,
    finish: async(owner,snap,p)=>{policy=p; return {status:'BLOCKED',wait_ms:300000};} },
    collect: async()=>{throw upstreamFailure(new Response(null,{status:403}));}, log:noLog });
  assert.equal((await worker.tick()).status,'BLOCKED');
  assert.equal(policy.blocked,true);
});

test('coordinator uses server-only bounded RPC and confirms exact persisted capture', async () => {
  const calls = [];
  const coordinator = new RefreshCoordinator({env:{SUPABASE_URL:'https://db.test/',SUPABASE_SERVICE_ROLE_KEY:'test-key'},
    fetcher:async(url,options)=>{
      calls.push({url,options});
      assert.equal(options.redirect,'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Authorization,'Bearer test-key');
      if(url.endsWith('tsr_refresh_claim')) return Response.json(acquired);
      if(url.endsWith('tsr_refresh_finish')) return Response.json(done);
      return Response.json([{id:done.run_id,status:'COMPLETE',snapshot}]);
    }});
  assert.equal((await coordinator.claim(done.run_id)).status,'ACQUIRED');
  assert.equal((await coordinator.finish(done.run_id,snapshot)).status,'COMPLETE');
  assert.equal(calls.length,3);
  assert.equal(JSON.parse(calls[1].options.body).p_owner,done.run_id);
  assert.match(calls[2].url,/id=eq\.00000000/);
});

test('coordinator rejects malformed RPC, timeout, HTTP failure and mismatched readback', async () => {
  const env = {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-key'};
  assert.throws(()=>new RefreshCoordinator({env:{}}),/CONFIG/);
  for(const fetcher of [async()=>Response.json({}),async()=>new Response(null,{status:503}),
    async()=>{throw new DOMException('timeout','TimeoutError');}]) {
    await assert.rejects(new RefreshCoordinator({env,fetcher}).claim(done.run_id));
  }
  const c = new RefreshCoordinator({env,fetcher:async url=>url.includes('/rpc/')
    ? Response.json(done) : Response.json([{id:done.run_id,status:'COMPLETE',snapshot:{...snapshot,generated_at:'old'}}])});
  await assert.rejects(c.finish(done.run_id,snapshot),/READBACK_INVALID/);
});

test('a lost lease never publishes outside the fenced coordinator', async () => {
  const logs = [];
  const worker = createRefreshWorker({coordinator:{claim:async()=>acquired,
    finish:async()=>({status:'LEASE_LOST',wait_ms:300000})}, collect:async()=>snapshot,log:l=>logs.push(l)});
  assert.equal((await worker.tick()).status,'LEASE_LOST');
  assert.equal(JSON.parse(logs[0]).generated_at,undefined);
});
