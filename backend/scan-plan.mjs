import { resolveCollection, resolveScope, TIER_WEIGHTS, RARITY_SCOPE, PILOT_CAPABILITY } from './collection-registry.mjs';

// Static allocation only. Largest remainders keep the exact integer budget;
// unavailable tiers are omitted and their weight redistributed to available tiers.
export function planScans({ budget, capabilities = [PILOT_CAPABILITY], compareScopes = () => 0 }) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 10000) throw new Error('INVALID_SCAN_BUDGET');
  const scopes = new Map();
  for (const capability of capabilities) {
    const record = resolveCollection(capability.collection);
    const scope = resolveScope({ collection: record.id, rarity: capability.rarity }, capability);
    for (const variant of capability.variants) resolveScope({ collection: record.id, rarity: capability.rarity, variant }, capability);
    const { variant: _variant, ...scanScope } = scope;
    const key = JSON.stringify([scope.source, record.id, scope.rarity]);
    if (scopes.has(key)) throw new Error('DUPLICATE_SCAN_SCOPE');
    scopes.set(key, Object.freeze({ ...scanScope, variants: Object.freeze([...new Set(capability.variants)].sort()) }));
  }
  const tiers = Object.keys(TIER_WEIGHTS).filter(tier => [...scopes.values()].some(s => s.collection_priority_tier === tier));
  const weight = tiers.reduce((sum, tier) => sum + TIER_WEIGHTS[tier], 0);
  const allocations = tiers.map(tier => {
    const exact = budget * TIER_WEIGHTS[tier] / weight;
    return { tier, jobs: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let extra = budget - allocations.reduce((sum, a) => sum + a.jobs, 0);
  for (const a of [...allocations].sort((a, b) => b.remainder - a.remainder || a.tier.localeCompare(b.tier))) {
    if (extra-- > 0) a.jobs++;
  }
  const result = [];
  for (const { tier, jobs } of allocations) {
    const candidates = [...scopes.values()].filter(s => s.collection_priority_tier === tier)
      .sort((a, b) => compareScopes(a, b) || RARITY_SCOPE.indexOf(a.rarity) - RARITY_SCOPE.indexOf(b.rarity) || a.collection_id.localeCompare(b.collection_id));
    candidates.forEach((scope, i) => {
      const count = Math.floor(jobs / candidates.length) + (i < jobs % candidates.length ? 1 : 0);
      if (count) result.push(Object.freeze({ ...scope, jobs: count }));
    });
  }
  return Object.freeze(result);
}

export function pilotScanPlan() {
  return planScans({ budget: 10 })[0];
}
