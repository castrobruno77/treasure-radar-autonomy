// Product coverage contract: #39. IDs are stable and never inferred from substrings.
export const REGISTRY_VERSION = 'COLLECTION_REGISTRY_V1';
export const RARITY_SCOPE = Object.freeze(['Consumer Grade', 'Industrial Grade']);
export const TIER_WEIGHTS = Object.freeze({ P0: 60, P1: 30, P2: 10 });
const definitions = [
  ['mirage-2021', '2021 Mirage', '2021', 'P0', ['Mirage 2021']],
  ['vertigo-2021', '2021 Vertigo', '2021', 'P0', ['Vertigo 2021']],
  ['ancient', 'Ancient', 'original', 'P0'],
  ['norse', 'Norse', 'original', 'P0'],
  ['st-marc', 'St. Marc', 'original', 'P0', ['St Marc']],
  ['canals', 'Canals', 'original', 'P0'],
  ['cobblestone', 'Cobblestone', 'original', 'P0'],
  ['chop-shop', 'Chop Shop', 'original', 'P0'],
  ['overpass-legacy', 'Overpass', 'legacy', 'P1'],
  ['assault', 'Assault', 'original', 'P1'],
  ['aztec', 'Aztec', 'original', 'P1'],
  ['train-legacy', 'Train', 'legacy', 'P1', ['Train legacy']],
  ['train-2021', '2021 Train', '2021', 'P1', ['Train 2021']],
  ['nuke-legacy', 'Nuke', 'legacy', 'P1', ['Nuke legacy']],
  ['cache', 'Cache', 'original', 'P1'],
  ['rising-sun', 'Rising Sun', 'original', 'P1'],
  ['gods-and-monsters', 'Gods and Monsters', 'original', 'P2'],
  ['control', 'Control', 'original', 'P2'],
  ['havoc', 'Havoc', 'original', 'P2'],
  ['dust2-2021', '2021 Dust 2', '2021', 'P2', ['Dust 2 2021', 'Dust2 2021']],
];
const token = value => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('UNKNOWN_COLLECTION');
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
};
export const COLLECTIONS = Object.freeze(definitions.map(([id, name, generation, tier, aliases = []]) =>
  Object.freeze({ id, name: `The ${name} Collection`, generation,
    collection_priority_tier: tier, rarity_scope: RARITY_SCOPE,
    aliases: Object.freeze([id, name, `The ${name} Collection`, ...aliases]) })));
const index = new Map();
for (const record of COLLECTIONS) for (const alias of record.aliases) {
  const key = token(alias);
  if (index.has(key) && index.get(key) !== record) throw new Error('COLLECTION_ALIAS_COLLISION');
  index.set(key, record);
}
export function resolveCollection(value) {
  const record = index.get(token(value));
  if (!record) throw new Error('UNKNOWN_COLLECTION');
  return record;
}

// This is an evidence-backed collector capability, not a claim that every
// registry collection/rarity/variant is available in the upstream API.
export const PILOT_CAPABILITY = Object.freeze({
  collection: 'mirage-2021', rarity: RARITY_SCOPE[0], source: 'DMarket',
  variants: Object.freeze(['NORMAL', 'SOUVENIR']),
  souvenir_signal_validated: true, stattrak_supported: false,
});

export function resolveScope({ collection, rarity, variant = 'NORMAL', purpose = 'signal' }, capability) {
  const record = resolveCollection(collection);
  if (!record.rarity_scope.includes(rarity)) throw new Error('RARITY_OUT_OF_SCOPE');
  if (!['signal', 'trade-up'].includes(purpose)) throw new Error('UNSUPPORTED_PURPOSE');
  if (!['NORMAL', 'SOUVENIR', 'STATTRAK'].includes(variant)) throw new Error('UNSUPPORTED_VARIANT');
  if (!capability || resolveCollection(capability.collection).id !== record.id ||
      capability.rarity !== rarity || capability.source !== 'DMarket' ||
      !capability.variants?.includes(variant)) throw new Error('UNSUPPORTED_COLLECTOR_SCOPE');
  if (variant === 'SOUVENIR' && (purpose !== 'signal' || capability.souvenir_signal_validated !== true))
    throw new Error('SOUVENIR_NOT_ELIGIBLE');
  if (variant === 'STATTRAK' && capability.stattrak_supported !== true)
    throw new Error('STATTRAK_NOT_SUPPORTED');
  return Object.freeze({ collection_id: record.id, collection: record.name,
    generation: record.generation, collection_priority_tier: record.collection_priority_tier,
    source: capability.source, rarity, variant });
}

// Use this identity for any local baseline/cache; variant and generation cannot
// collapse even when a provider uses similar display names.
export function comparatorPoolKey(scope, itemName) {
  if (typeof itemName !== 'string' || !itemName.trim()) throw new Error('INVALID_POOL_ITEM');
  const record = resolveCollection(scope.collection_id);
  if (scope.collection !== record.name || !record.rarity_scope.includes(scope.rarity) ||
      !['NORMAL', 'SOUVENIR', 'STATTRAK'].includes(scope.variant) || scope.source !== 'DMarket')
    throw new Error('INVALID_POOL_SCOPE');
  return JSON.stringify([scope.source, record.id, scope.rarity, scope.variant, itemName]);
}
