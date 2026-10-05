import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCsDeals, normalizeWaxpeer } from '../backend/market-normalization.mjs';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/market-normalization.json', import.meta.url)));
for (const [source, normalize, id, float, name, divisor] of [
  ['csdeals', normalizeCsDeals, 'id', 'cs_paint_wear', 'market_hash_name', 100],
  ['waxpeer', normalizeWaxpeer, 'item_id', 'float', 'name', 1000]
]) {
  const fixture = () => structuredClone(fixtures[source]);
  test(`${source}: fixed monetary units across magnitudes; pure deterministic capture`, () => {
    const input = fixture(), original = structuredClone(input);
    assert.deepEqual(normalize(input).map(r => r.price_usd), [0.33, 1.25]);
    assert.deepEqual(input, original);
    for (const price of [0, 1, 99, 100, 999, 1000, 1000000]) {
      input.items[0].price = price;
      assert.equal(normalize(input)[0].price_usd, price / divisor);
    }
    assert.equal(normalize(input)[0].captured_at, normalize(input)[0].captured_at);
    assert.equal(normalize({...input, items: []}).length, 0);
  });
  test(`${source}: missing/null/coerced numeric fields and invalid bounds fail closed`, () => {
    for (const field of ['price', float]) {
      for (const value of [undefined, null, '', ' ', false, true, [], {}, NaN, Infinity, -1, '0x10', '1e3']) {
        const input = fixture(); input.items[0][field] = value;
        assert.throws(() => normalize(input), new RegExp(`INVALID_${field === 'price' ? 'PRICE' : 'FLOAT'}`));
      }
    }
    for (const price of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const input = fixture(); input.items[0].price = price;
      assert.throws(() => normalize(input), /INVALID_PRICE/);
    }
    const input = fixture(); input.items[0][float] = 1.01;
    assert.throws(() => normalize(input), /INVALID_FLOAT/);
    for (const f of [0, 1, '0.25']) {
      input.items[0][float] = f; assert.equal(normalize(input)[0].float, Number(f));
    }
  });
  test(`${source}: stable IDs, required names, duplicates and malformed rows`, () => {
    for (const value of [undefined, null, '', ' ', ' x ', false, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const input = fixture(); input.items[0][id] = value;
      assert.throws(() => normalize(input), /INVALID_ID/);
    }
    for (const value of [undefined, null, '', ' ', false]) {
      const input = fixture(); input.items[0][name] = value;
      assert.throws(() => normalize(input), /INVALID_NAME/);
    }
    const input = fixture(); input.items[0][id] = 123; input.items[1][id] = '123';
    assert.throws(() => normalize(input), /DUPLICATE_LISTING_ID/);
    for (const row of [null, [], 1]) assert.throws(() => normalize({...fixture(), items: [row]}), /INVALID_ITEM/);
    for (const payload of [null, {}, {items: null}]) assert.throws(() => normalize(payload), /INVALID_ITEMS/);
  });
}
test('capture timestamps are explicit, valid and never supplied by wall clock', () => {
  for (const timestamp of [undefined, null, '', false, -1, 0, 1.5, Infinity, 253402300800]) {
    assert.throws(() => normalizeWaxpeer({...fixtures.waxpeer, timestamp}), /INVALID_TIMESTAMP/);
  }
  assert.equal(normalizeWaxpeer(fixtures.waxpeer)[0].captured_at, new Date(fixtures.waxpeer.timestamp * 1000).toISOString());
  for (const captured_at of [undefined, null, '', 'bad', '2026-02-30T00:00:00Z', '2026-10-03', '2026-10-03T12:00:00']) {
    const input = structuredClone(fixtures.csdeals); input.items[0].captured_at = captured_at;
    assert.throws(() => normalizeCsDeals(input), /INVALID_CAPTURED_AT/);
  }
  assert.equal(normalizeCsDeals(fixtures.csdeals)[0].captured_at, '2026-10-03T21:24:00.000Z');
});
