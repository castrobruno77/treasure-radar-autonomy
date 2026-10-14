import test from 'node:test';
import assert from 'node:assert/strict';
import { P0_CELLS, P0_ITEMS, observeP0Identity } from '../backend/dmarket-p0.mjs';
import { runDmarketP0Probe } from '../scripts/check-dmarket-p0.mjs';

const env = { DMARKET_PUBLIC_KEY: 'a'.repeat(64), DMARKET_SECRET_KEY: 'b'.repeat(64) };
const offer = (cell, variant = 'NORMAL') => {
  const item = cell.items[0];
  return { offerId: 'test-offer', priceCents: '100', attributes: {
    name: item.base_name, title: `${variant === 'SOUVENIR' ? 'Souvenir ' : ''}${item.base_name} (Minimal Wear)`,
    cs2: { collection: cell.source_collection, category: `CATEGORY_${variant}`,
      quality: 'QUALITY_TEST_ONLY', float: '0.075' } } };
};
test('canonical universe: 70 identities, 16 cells, 24 allowed variant scopes; no StatTrak', () => {
  assert.equal(P0_ITEMS.length, 70);
  assert.equal(P0_CELLS.length, 16);
  assert.equal(P0_CELLS.reduce((n, c) => n + c.variants.length, 0), 24);
  assert.equal(P0_ITEMS.filter(r => r.rarity === 'Consumer Grade').length, 39);
  assert.equal(P0_ITEMS.filter(r => r.rarity === 'Industrial Grade').length, 31);
  assert.ok(P0_ITEMS.every(r => r.stattrak_allowed === false));
  assert.equal(new Set(P0_ITEMS.map(r => [r.collection_id, r.generation, r.rarity, r.base_name].join('|'))).size, 70);
});
test('observations never certify unknown rarity literals or claim activation', () => {
  const cell = P0_CELLS[0], row = observeP0Identity(offer(cell), cell, cell.items[0], 'NORMAL');
  assert.equal(row.rarity_status, 'OBSERVED_NOT_CERTIFIED');
  assert.equal(row.production_activated, false);
  assert.equal(row.source_quality, 'QUALITY_TEST_ONLY');
  assert.equal(row.price_cents, 100);
});
test('identity rejects generation/variant/collection/name/float mismatches and absent rarity', () => {
  const cell = P0_CELLS[0], item = cell.items[0];
  for (const change of [
    r => r.attributes.cs2.collection = 'the mirage collection',
    r => r.attributes.cs2.category = 'CATEGORY_STATTRAK',
    r => r.attributes.title = r.attributes.title.replace('MAC-10', 'MAC-10 fake'),
    r => r.attributes.name = 'Sienna Damask',
    r => r.attributes.cs2.float = null,
    r => r.attributes.cs2.float = '0.9',
    r => r.attributes.cs2.quality = null
  ]) {
    const r = offer(cell); change(r);
    assert.throws(() => observeP0Identity(r, cell, item, 'NORMAL'), /DMARKET_P0_/);
  }
  const norse = P0_CELLS.find(c => c.collection_id === 'norse');
  assert.throws(() => observeP0Identity(offer(norse, 'SOUVENIR'), norse, norse.items[0], 'SOUVENIR'), /SCOPE/);
});
test('probe visits every allowed scope, signs only GET offers and never dumps raw data', async () => {
  let calls = 0;
  const report = await runDmarketP0Probe({ env, pause: async () => {}, fetcher: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.dmarket.com');
    assert.equal(url.pathname, '/marketplace-api/v2/offers');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.match(options.headers['X-Request-Sign'], /^dmar ed25519 [a-f0-9]{128}$/);
    assert.equal(url.searchParams.get('limit'), '5');
    return Response.json({ items: [], secret_field: 'NEVER_PRINT' });
  } });
  assert.equal(report.status, 'READ_COMPLETE');
  assert.equal(report.cells.length, 16);
  assert.equal(calls, 24);
  assert.equal(report.planner_exercised, false);
  assert.equal(report.production_activated, false);
  assert.ok(!JSON.stringify(report).includes('NEVER_PRINT'));
  assert.ok(report.cells.every(c => c.requests.every(r => r.rows === 0)));
});
test('probe stops on first denial/rate limit and reports the response without retries', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const report = await runDmarketP0Probe({ env, fetcher: async () => {
      calls++; return new Response('', { status, headers: { 'retry-after': '1200' } });
    } });
    assert.equal(calls, 1);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.error, `HTTP_${status}`);
    assert.equal(report.cells[0].requests[0].retry_after_seconds, 1200);
  }
});
test('probe fails closed on absent credentials, oversized and malformed responses', async () => {
  const missing = await runDmarketP0Probe({ env: {}, fetcher: () => assert.fail('network forbidden') });
  assert.equal(missing.error, 'CREDENTIAL_UNAVAILABLE');
  for (const [body, error] of [['x'.repeat(1048577), 'RESPONSE_CAP'], ['oops', 'INVALID_JSON'], ['{}', 'RESPONSE_SCHEMA']]) {
    const report = await runDmarketP0Probe({ env, fetcher: async () => new Response(body) });
    assert.equal(report.error, error);
    assert.equal(report.calls, 1);
  }
});
