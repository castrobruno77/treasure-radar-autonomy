import test from 'node:test';
import assert from 'node:assert/strict';
import { P0_CELLS, p0CollectionKey, observeP0Identity } from '../backend/dmarket-p0.mjs';

const keys = {
  'mirage-2021': ['2021', 'mirage'], 'vertigo-2021': ['2021', 'vertigo'],
  ancient: ['ancient'], norse: ['norse'], 'st-marc': ['marc', 'st'],
  canals: ['canals'], cobblestone: ['cobblestone'], 'chop-shop': ['chop', 'shop']
};
const offer = (cell, collection) => ({ offerId: 'test', priceCents: 100,
  attributes: { name: cell.items[0].base_name, cs2: { collection,
    category: 'CATEGORY_NORMAL', quality: 'QUALITY_TEST_ONLY', float: .075 } } });

test('all eight canonical P0 collections have distinct nonempty token multisets', () => {
  const collections = [...new Map(P0_CELLS.map(c => [c.collection_id, c])).values()];
  assert.equal(collections.length, 8);
  assert.deepEqual(collections.map(c => c.collection_id).sort(), Object.keys(keys).sort());
  for (const cell of P0_CELLS)
    assert.equal(p0CollectionKey(cell.source_collection), JSON.stringify(keys[cell.collection_id]));
  assert.equal(new Set(collections.map(c => p0CollectionKey(c.source_collection))).size, 8);
});

test('all 16 cells admit equivalent order, case, separators and whole stop tokens only', () => {
  for (const cell of P0_CELLS) {
    const tokens = keys[cell.collection_id];
    for (const value of [cell.source_collection, tokens.join(' '),
      tokens.toReversed().join('-').toUpperCase(), ` THE / ${tokens.join('._')} / COLLECTION `]) {
      const result = observeP0Identity(offer(cell, value), cell, cell.items[0], 'NORMAL');
      assert.equal(result.collection_id, cell.collection_id);
      assert.equal(result.source_collection, value);
      assert.equal(result.production_activated, false);
      assert.equal(result.rarity_status, 'OBSERVED_NOT_CERTIFIED');
    }
  }
});

test('extra, missing, duplicate, wrong-year and every neighboring collection fail closed', () => {
  for (const cell of P0_CELLS) {
    const tokens = keys[cell.collection_id];
    const invalid = [null, undefined, {}, [], 2021, '', 'the collection', '---',
      `${tokens.join(' ')} extra`, `${tokens.join(' ')} ${tokens[0]}`,
      `${tokens.join(' ')} theme`, `${tokens.join(' ')} collections`,
      ...tokens.map((_, i) => tokens.filter((_, j) => i !== j).join(' ')),
      ...Object.entries(keys).filter(([id]) => id !== cell.collection_id).map(([, t]) => t.join(' '))];
    if (tokens.includes('2021')) invalid.push('2020 ' + tokens[1], '20210 ' + tokens[1]);
    if (tokens.length > 1) invalid.push(tokens.join(''));
    for (const value of invalid)
      assert.throws(() => observeP0Identity(offer(cell, value), cell, cell.items[0], 'NORMAL'),
        { message: 'DMARKET_P0_COLLECTION' });
  }
  assert.notEqual(p0CollectionKey('mirage mirage 2021'), p0CollectionKey('mirage 2021'));
  assert.notEqual(p0CollectionKey('mírage 2021'), p0CollectionKey('mirage 2021'));
  assert.notEqual(p0CollectionKey('themirage 2021'), p0CollectionKey('mirage 2021'));
});
