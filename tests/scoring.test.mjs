import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORING_VERSION,
  QUALITY_WEIGHTS,
  ECONOMIC_WEIGHTS,
  applyScoring,
  comparatorEvidencePoints,
  deriveActionTier,
  floatQualityPoints,
  priceEdgePoints
} from '../backend/scoring.mjs';

const item = (overrides = {}) => ({
  id: 'dmarket:test',
  source: 'DMarket',
  collection: 'The 2021 Mirage Collection',
  rarity: 'Consumer Grade',
  market_hash_name: 'Test (Factory New)',
  normalized_float: 0.03,
  robust_gap_pct: 50,
  peer_count: 4,
  listing_url: 'https://dmarket.com/ingame-items/item-list/csgo-skins?test=1',
  captured_at: '2026-10-08T00:00:00.000Z',
  status: 'CERTIFIED',
  ...overrides
});

test('v0.2 canonical weights remain separate and total 100 each', () => {
  assert.equal(Object.values(QUALITY_WEIGHTS).reduce((a,b)=>a+b,0), 100);
  assert.equal(Object.values(ECONOMIC_WEIGHTS).reduce((a,b)=>a+b,0), 100);
});

test('quality score uses only observed/validated evidence and leaves unavailable weights N-D', () => {
  const scored = applyScoring(item());
  assert.equal(scored.scoring_version, SCORING_VERSION);
  assert.equal(scored.quality_evidence.components.price_edge.points, 30);
  assert.equal(scored.quality_evidence.components.float_quality.points, 19.4);
  assert.equal(scored.quality_evidence.components.comparator_evidence.points, 8);
  assert.equal(scored.quality_evidence.components.market_data_confidence.points, 10);
  assert.equal(scored.quality_evidence.components.scarcity_urgency.points, null);
  assert.equal(scored.quality_evidence.components.liquidity.points, null);
  assert.equal(scored.quality_evidence.known_weight, 80);
  assert.equal(scored.quality_evidence.unavailable_weight, 20);
  assert.equal(scored.quality_score, 67.4);
  assert.equal(scored.economic_action_score, null);
  assert.equal(scored.economic_evidence.status, 'BLOCKED');
  assert.equal(scored.action_tier, 'BLOCKED');
});

test('historical evidence thresholds are conservatively rescaled into v0.2 weights', () => {
  assert.deepEqual([9,10,15,25,40].map(priceEdgePoints), [0,7.5,15,22.5,30]);
  assert.deepEqual([3,4,6,10,20].map(comparatorEvidencePoints), [null,8,12,16,20]);
  assert.equal(floatQualityPoints(0), 20);
  assert.equal(floatQualityPoints(1), 0);
});

test('quality and actionability gates are separate', () => {
  assert.equal(applyScoring(item({ status:'REJECTED' })).quality_score, null);
  const missingLink = applyScoring(item({ listing_url:null }));
  assert.equal(missingLink.quality_score, 67.4);
  assert.equal(missingLink.action_tier, 'BLOCKED');
  assert.deepEqual(missingLink.actionability_blockers, ['LISTING_URL_REQUIRED']);
  assert.equal(applyScoring(item({ peer_count:3 })).quality_score, null);
});

test('action tiers require both scores and preserve freshness/actionability gates', () => {
  assert.equal(deriveActionTier({ qualityScore:90, economicScore:85 }), 'DIAMOND');
  assert.equal(deriveActionTier({ qualityScore:75, economicScore:70 }), 'TREASURE');
  assert.equal(deriveActionTier({ qualityScore:75, economicScore:60 }), 'WATCH');
  assert.equal(deriveActionTier({ qualityScore:90, economicScore:85, fresh:false }), 'WATCH');
  assert.equal(deriveActionTier({ qualityScore:90, economicScore:85, actionable:false }), 'BLOCKED');
  assert.equal(deriveActionTier({ qualityScore:90, economicScore:null }), 'BLOCKED');
});

test('economic components respect v0.2 qualitative boundaries', async () => {
  const m = await import('../backend/scoring.mjs');
  assert.deepEqual([0,2.5,5,7.5,10,15,20].map(m.netMarginPoints), [0,5,10,15,20,32.5,45]);
  assert.deepEqual([1,2,5,10].map(m.executableDepthPoints), [10,15,20,25]);
  assert.deepEqual([0,3,7,12,20].map(sampleCount => m.economicLiquidityPoints({sampleCount,latestSaleAgeDays:1})), [0,5,10,15,20]);
  assert.deepEqual([-1,5,10,20,21].map(m.spreadFrictionPoints), [10,8,6,3,0]);
});
