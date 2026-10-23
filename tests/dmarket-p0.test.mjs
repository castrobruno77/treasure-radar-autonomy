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
test('arbitrary or missing title cannot change canonical identity or certify rarity', () => {
  const cell = P0_CELLS[0], item = cell.items[0];
  for (const variant of ['NORMAL', 'SOUVENIR']) {
    const expected = observeP0Identity(offer(cell, variant), cell, item, variant);
    assert.equal(expected.market_hash_name, `${variant === 'SOUVENIR' ? 'Souvenir ' : ''}${item.base_name} (Minimal Wear)`);
    assert.equal(expected.rarity_status, 'OBSERVED_NOT_CERTIFIED');
    assert.equal(expected.production_activated, false);
    for (const title of ['arbitrary', `${item.base_name} (Factory New)`, 'StatTrak™ fake', '', null, 12, {}, undefined]) {
      const r = offer(cell, variant);
      if (title === undefined) delete r.attributes.title;
      else r.attributes.title = title;
      assert.deepEqual(observeP0Identity(r, cell, item, variant), expected);
    }
    const r = offer(cell, variant);
    Object.defineProperty(r.attributes, 'title', { get() { assert.fail('title must not be read'); } });
    assert.deepEqual(observeP0Identity(r, cell, item, variant), expected);
  }
});
test('canonical wear boundaries use exact float for both variants, including endpoints', () => {
  for (const [f, wear] of [[0, 'Factory New'], [.069999999, 'Factory New'], [.07, 'Minimal Wear'],
    [.149999999, 'Minimal Wear'], [.15, 'Field-Tested'], [.379999999, 'Field-Tested'],
    [.38, 'Well-Worn'], [.449999999, 'Well-Worn'], [.45, 'Battle-Scarred'], [1, 'Battle-Scarred']]) {
    // No souvenir-eligible catalog item reaches 1; its item-range guard must reject it.
    for (const variant of f === 1 ? ['NORMAL'] : ['NORMAL', 'SOUVENIR']) for (const value of [f, String(f)]) {
      const cell = P0_CELLS.find(c => c.variants.includes(variant) && c.items.some(i => i.float_min <= f && i.float_max >= f));
      assert.ok(cell, `catalog covers ${variant} float ${f}`);
      const item = cell.items.find(i => i.float_min <= f && i.float_max >= f);
      const r = offer(cell, variant); r.attributes.name = item.base_name; r.attributes.cs2.float = value;
      assert.equal(observeP0Identity(r, cell, item, variant).market_hash_name,
        `${variant === 'SOUVENIR' ? 'Souvenir ' : ''}${item.base_name} (${wear})`);
    }
  }
});
test('all strong identity and listing guards remain fail-closed without title', () => {
  const cell = P0_CELLS[0], item = cell.items[0];
  const cases = [
    ...['wrong', '', null, undefined, `StatTrak™ ${item.base_name}`, `Souvenir ${item.base_name}`].map(v => ['EXACT_NAME', r => r.attributes.name = v]),
    ...[null, '', 'the mirage collection', `${cell.source_collection} extra`].map(v => ['COLLECTION', r => r.attributes.cs2.collection = v]),
    ...[null, '', 'CATEGORY_STATTRAK', 'CATEGORY_SOUVENIR'].map(v => ['CATEGORY', r => r.attributes.cs2.category = v]),
    ...[null, undefined, '', ' ', '.07', 'NaN', 'Infinity', '0.1x', true, {}, NaN, Infinity, -Infinity, -.01, 1.00000001, item.float_max + .000001].map(v => ['FLOAT', r => r.attributes.cs2.float = v]),
    ...[null, '', 42, {}, 'QUALITY_123'].map(v => ['QUALITY_MISSING', r => r.attributes.cs2.quality = v]),
    ...[null, '', 12, 'bad/id', 'x'.repeat(129)].map(v => ['LISTING', r => r.offerId = v]),
    ...[null, '', 0, -1, 1.5, '1.5', 'NaN', Infinity, Number.MAX_SAFE_INTEGER + 1].map(v => ['LISTING', r => r.priceCents = v])
  ];
  for (const [code, change] of cases) {
    const r = offer(cell); delete r.attributes.title;
    r.attributes.cs2.collection = 'Mirage 2021'; change(r);
    assert.throws(() => observeP0Identity(r, cell, item, 'NORMAL'), { message: `DMARKET_P0_${code}` });
  }
  for (const variant of ['STATTRAK', 'normal', '', null])
    assert.throws(() => observeP0Identity(offer(cell), cell, item, variant), /SCOPE/);
  assert.throws(() => observeP0Identity(offer(cell), { ...cell }, item, 'NORMAL'), /SCOPE/);
  assert.throws(() => observeP0Identity(offer(cell), cell, { ...item }, 'NORMAL'), /SCOPE/);
  for (const c of P0_CELLS) {
    if (!c.variants.includes('SOUVENIR'))
      assert.throws(() => observeP0Identity(offer(c, 'SOUVENIR'), c, c.items[0], 'SOUVENIR'), /SCOPE/);
    else {
      const r = offer(c, 'SOUVENIR'); r.attributes.cs2.float = 1;
      assert.throws(() => observeP0Identity(r, c, c.items[0], 'SOUVENIR'), /FLOAT/);
      r.attributes.cs2.float = .075; r.attributes.cs2.category = 'CATEGORY_NORMAL';
      assert.throws(() => observeP0Identity(r, c, c.items[0], 'SOUVENIR'), /CATEGORY/);
    }
    for (const i of c.items) for (const f of [i.float_min, i.float_max, i.float_min - .000001, i.float_max + .000001]) {
      const r = offer(c); r.attributes.name = i.base_name; r.attributes.cs2.float = f;
      if (f < i.float_min || f > i.float_max)
        assert.throws(() => observeP0Identity(r, c, i, 'NORMAL'), /FLOAT/);
      else assert.doesNotThrow(() => observeP0Identity(r, c, i, 'NORMAL'));
    }
  }
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
