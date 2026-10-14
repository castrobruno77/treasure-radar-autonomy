// #75 consumes #63/#64 mechanically. Eligibility is not runtime activation.
import catalog from './csdeals-catalog.json' with { type: 'json' };
import { resolveCollection, RARITY_SCOPE } from './collection-registry.mjs';

export const P0_CATALOG_VERSION = catalog.version;
export const P0_ITEMS = Object.freeze(catalog.items.map(row => Object.freeze({ ...row })));
export const P0_CELLS = Object.freeze([...new Set(P0_ITEMS.map(r => r.collection_id))].flatMap(collection =>
  RARITY_SCOPE.map(rarity => {
    const record = resolveCollection(collection);
    const items = P0_ITEMS.filter(r => r.collection_id === collection && r.rarity === rarity);
    if (!items.length || items.some(r => r.generation !== record.generation || !r.normal_allowed || r.stattrak_allowed))
      throw Error('DMARKET_P0_CATALOG_INVALID');
    return Object.freeze({ collection_id: collection, generation: record.generation,
      collection: record.name, rarity, source_collection: record.name.toLowerCase(),
      variants: Object.freeze(items.every(r => r.souvenir_allowed) ? ['NORMAL', 'SOUVENIR'] : ['NORMAL']),
      items: Object.freeze(items) });
  })));

const wears = new Map([
  ['Factory New', [0, .07]], ['Minimal Wear', [.07, .15]],
  ['Field-Tested', [.15, .38]], ['Well-Worn', [.38, .45]], ['Battle-Scarred', [.45, 1.0000001]]
]);
const fail = code => { throw Error(`DMARKET_P0_${code}`); };

// This is a provenance observation, NOT a rarity-certified production listing.
// #64 requires observed low-tier enum literals before activation. Do not guess them.
export function observeP0Identity(offer, cell, item, variant) {
  if (!P0_CELLS.includes(cell) || !cell.items.includes(item) || !cell.variants.includes(variant)) fail('SCOPE');
  const attrs = offer?.attributes, cs = attrs?.cs2;
  const prefix = variant === 'SOUVENIR' ? 'Souvenir ' : '';
  const title = attrs?.title;
  const wear = [...wears.keys()].find(w => title === `${prefix}${item.base_name} (${w})`);
  if (!wear || attrs.name !== item.base_name) fail('EXACT_NAME');
  if (cs?.collection !== cell.source_collection) fail('COLLECTION');
  if (cs.category !== `CATEGORY_${variant}`) fail('CATEGORY');
  if (typeof cs.quality !== 'string' || !/^[A-Za-z_ ]{1,64}$/.test(cs.quality)) fail('QUALITY_MISSING');
  if (!(typeof cs.float === 'number' || typeof cs.float === 'string' && /^(?:0|1)(?:\.\d+)?$/.test(cs.float))) fail('FLOAT');
  const f = Number(cs.float), [lo, hi] = wears.get(wear);
  if (!Number.isFinite(f) || f < item.float_min || f > item.float_max || f < lo || f >= hi) fail('FLOAT');
  const id = offer.offerId ?? offer.id;
  const cents = typeof offer.priceCents === 'string' && /^\d+$/.test(offer.priceCents) ? Number(offer.priceCents) : offer.priceCents;
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(id) ||
      !Number.isSafeInteger(cents) || cents <= 0) fail('LISTING');
  return { collection_id: cell.collection_id, generation: cell.generation, rarity: cell.rarity,
    variant, base_name: item.base_name, market_hash_name: title, source_listing_id: id,
    source_collection: cs.collection, source_category: cs.category, source_quality: cs.quality,
    exact_float: f, price_cents: cents, catalog_version: P0_CATALOG_VERSION,
    rarity_status: 'OBSERVED_NOT_CERTIFIED', production_activated: false };
}
