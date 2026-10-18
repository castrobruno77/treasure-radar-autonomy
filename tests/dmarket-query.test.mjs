import test from 'node:test';
import assert from 'node:assert/strict';
import { runDmarketQueryDiagnostic as run } from '../scripts/check-dmarket-query.mjs';
import { P0_CELLS } from '../backend/dmarket-p0.mjs';
const env = { DMARKET_PUBLIC_KEY: 'a'.repeat(64), DMARKET_SECRET_KEY: 'b'.repeat(64) };
const opts = { env, pause: async () => {} };
function row(url) {
  const title = url.searchParams.get('title');
  const cell = P0_CELLS.find(c => c.collection_id === 'mirage-2021' && c.items.some(i => i.base_name === title));
  return { offerId: 'test-offer', priceCents: '100', attributes: { name: title, title: `${title} (Minimal Wear)`,
    cs2: { collection: cell.source_collection, category: 'CATEGORY_NORMAL', quality: 'TEST_ONLY', float: '0.075' } } };
}
test('empty diagnostic is four signed narrow GETs, no quality or broad control and no absence claim', async () => {
  const report = await run({ ...opts, fetcher: async (url, options) => {
    assert.equal(url.origin, 'https://api.dmarket.com');
    assert.equal(url.pathname, '/marketplace-api/v2/offers');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.match(options.headers['X-Request-Sign'], /^dmar ed25519 [a-f0-9]{128}$/);
    assert.deepEqual([...url.searchParams.keys()], ['gameId', 'title', 'limit']);
    assert.equal(url.searchParams.get('limit'), '5');
    assert.ok(P0_CELLS.some(c => c.items.some(i => i.base_name === url.searchParams.get('title'))));
    return Response.json({ items: [], unexpected: 'PRIVATE_DATA' });
  } });
  assert.equal(report.calls, 4); assert.equal(report.status, 'READ_COMPLETE');
  assert.ok(report.cells.every(c => c.finding === 'BOTH_CANONICAL_TITLE_SAMPLES_EMPTY_INCONCLUSIVE'));
  assert.equal(report.production_activated, false); assert.equal(report.planner_exercised, false);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_DATA'));
});
test('positive title controls compare original filters with unchanged strict identity', async () => {
  const report = await run({ ...opts, fetcher: async url => Response.json({ items: [row(url)] }) });
  assert.equal(report.calls, 4);
  assert.ok(report.cells.every(c => c.finding === 'FILTERED_QUERY_HAS_STRICT_OBSERVATIONS'));
  assert.ok(report.cells.every(c => c.requests.every(r => r.observations[0].rarity_status === 'OBSERVED_NOT_CERTIFIED')));
});
test('alternate positives bracket filtered emptiness within eight-call maximum', async () => {
  const report = await run({ ...opts, fetcher: async url => {
    const first = P0_CELLS.filter(c => c.collection_id === 'mirage-2021').some(c => c.items[0].base_name === url.searchParams.get('title'));
    return Response.json({ items: first || url.searchParams.has('treeFilters') ? [] : [row(url)] });
  } });
  assert.equal(report.calls, 8);
  assert.ok(report.cells.every(c => c.finding === 'FILTER_ASSOCIATED_DIFFERENCE_BRACKETED'));
  assert.ok(report.cells.every(c => c.representative_difference));
});
test('changed control is inconclusive instead of claiming incompatible filters', async () => {
  let calls = 0;
  const report = await run({ ...opts, fetcher: async url => Response.json({ items: calls++ % 3 === 0 ? [row(url)] : [] }) });
  assert.equal(report.calls, 6);
  assert.ok(report.cells.every(c => c.finding === 'CONTROL_CHANGED_INCONCLUSIVE'));
});
test('schema and identity rejection remain observable without arbitrary data disclosure', async () => {
  for (const mutate of [r => r.attributes.cs2.category = 'CATEGORY_STATTRAK', r => r.attributes.cs2.collection = 'PRIVATE_DATA',
    r => r.attributes.cs2.float = null, r => r.attributes.title = 'PRIVATE_DATA', r => r.attributes.cs2.quality = null]) {
    const report = await run({ ...opts, fetcher: async url => { const r = row(url); mutate(r); return Response.json({ items: [r] }); } });
    assert.equal(report.calls, 2);
    assert.ok(report.cells.every(c => c.finding === 'ROWS_PRESENT_IDENTITY_CONTRACT_REJECTED'));
    assert.ok(!JSON.stringify(report).includes('PRIVATE_DATA'));
    assert.ok(report.cells.every(c => c.requests[0].observations.length === 0));
  }
  const report = await run({ ...opts, fetcher: async () => Response.json({ objects: [], private: 'PRIVATE_DATA' }) });
  assert.equal(report.error, 'RESPONSE_SCHEMA'); assert.equal(report.calls, 1);
  assert.equal(report.cells[0].requests[0].envelope.items, 'undefined');
  assert.ok(!JSON.stringify(report).includes('PRIVATE_DATA'));
});
test('auth, rate, server, size, JSON and transport failures stop without retry or secret echo', async () => {
  for (const status of [401, 403, 429, 503]) {
    const report = await run({ ...opts, fetcher: async () => new Response('', { status }) });
    assert.equal(report.calls, 1); assert.equal(report.error, `HTTP_${status}`);
  }
  for (const [body, error] of [['x'.repeat(1048577), 'RESPONSE_CAP'], ['x', 'INVALID_JSON'], [JSON.stringify({ items: Array(6).fill(null) }), 'RESPONSE_SCHEMA']]) {
    const report = await run({ ...opts, fetcher: async () => new Response(body) });
    assert.equal(report.calls, 1); assert.equal(report.error, error);
  }
  const report = await run({ ...opts, fetcher: async () => { throw Error(env.DMARKET_SECRET_KEY); } });
  assert.equal(report.error, 'TRANSPORT_OR_SIGNING_UNAVAILABLE');
  assert.ok(!JSON.stringify(report).includes(env.DMARKET_SECRET_KEY));
});
test('credentials and wall budget fail closed before network', async () => {
  const missing = await run({ env: {}, fetcher: () => assert.fail('network') });
  assert.equal(missing.calls, 0); assert.equal(missing.error, 'CREDENTIAL_UNAVAILABLE');
  let calls = 0;
  const budget = await run({ ...opts, now: () => calls++ ? 80000 : 0, fetcher: () => assert.fail('network') });
  assert.equal(budget.calls, 0); assert.equal(budget.error, 'PROBE_BUDGET');
});
