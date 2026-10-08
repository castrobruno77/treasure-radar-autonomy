export const SCORING_VERSION = 'TSR_TWO_SCORE_V0_2';

export const QUALITY_WEIGHTS = Object.freeze({
  price_edge: 30,
  float_quality: 20,
  comparator_evidence: 20,
  market_data_confidence: 10,
  scarcity_urgency: 5,
  liquidity: 15
});

export const ECONOMIC_WEIGHTS = Object.freeze({
  net_margin: 45,
  executable_buy_side_depth: 25,
  liquidity: 20,
  spread_exit_friction: 10
});

const round1 = value => Math.round(value * 10) / 10;

export function priceEdgePoints(gapPct) {
  if (!Number.isFinite(gapPct) || gapPct < 10) return 0;
  if (gapPct < 15) return 7.5;
  if (gapPct < 25) return 15;
  if (gapPct < 40) return 22.5;
  return 30;
}

export function floatQualityPoints(normalizedFloat) {
  if (!Number.isFinite(normalizedFloat) || normalizedFloat < 0 || normalizedFloat > 1) return null;
  return round1((1 - normalizedFloat) * QUALITY_WEIGHTS.float_quality);
}

export function comparatorEvidencePoints(peerCount) {
  if (!Number.isInteger(peerCount) || peerCount < 4) return null;
  if (peerCount <= 5) return 8;
  if (peerCount <= 9) return 12;
  if (peerCount <= 19) return 16;
  return 20;
}

export function deriveActionTier({ qualityScore, economicScore, fresh = true, actionable = true } = {}) {
  if (!Number.isFinite(qualityScore) || !Number.isFinite(economicScore)) return 'BLOCKED';
  if (!fresh || !actionable) return 'WATCH';
  if (qualityScore >= 85 && economicScore >= 80) return 'DIAMOND';
  if (qualityScore >= 70 && economicScore >= 65) return 'TREASURE';
  return 'WATCH';
}

export function scoreQuality(item) {
  const blockers = [];
  if (item?.status !== 'CERTIFIED') blockers.push('COMPARATOR_NOT_CERTIFIED');
  if (item?.source !== 'DMarket') blockers.push('SOURCE_NOT_VALIDATED');

  const components = {
    price_edge: { points: priceEdgePoints(item?.robust_gap_pct), max: QUALITY_WEIGHTS.price_edge, evidence: 'ROBUST_GAP' },
    float_quality: { points: floatQualityPoints(item?.normalized_float), max: QUALITY_WEIGHTS.float_quality, evidence: 'NORMALIZED_FLOAT_PROXY' },
    comparator_evidence: { points: comparatorEvidencePoints(item?.peer_count), max: QUALITY_WEIGHTS.comparator_evidence, evidence: 'PEER_COUNT' },
    market_data_confidence: { points: item?.source === 'DMarket' ? 10 : null, max: QUALITY_WEIGHTS.market_data_confidence, evidence: 'VALIDATED_SOURCE' },
    scarcity_urgency: { points: null, max: QUALITY_WEIGHTS.scarcity_urgency, evidence: 'N_D' },
    liquidity: { points: null, max: QUALITY_WEIGHTS.liquidity, evidence: 'N_D' }
  };

  if (components.float_quality.points === null) blockers.push('FLOAT_QUALITY_REQUIRED');
  if (components.comparator_evidence.points === null) blockers.push('COMPARATOR_EVIDENCE_REQUIRED');

  const known = Object.values(components).filter(c => Number.isFinite(c.points));
  const knownWeight = known.reduce((sum, c) => sum + c.max, 0);
  const score = blockers.length ? null : round1(known.reduce((sum, c) => sum + c.points, 0));

  return {
    score,
    status: blockers.length ? 'BLOCKED' : knownWeight < 100 ? 'PARTIAL' : 'COMPLETE',
    known_weight: knownWeight,
    unavailable_weight: 100 - knownWeight,
    blockers,
    components
  };
}

export function applyScoring(item) {
  const quality = scoreQuality(item);
  const actionabilityBlockers = [];
  if (!item?.listing_url) actionabilityBlockers.push('LISTING_URL_REQUIRED');
  if (item?.status !== 'CERTIFIED') actionabilityBlockers.push('COMPARATOR_NOT_CERTIFIED');
  const economic = {
    score: null,
    status: 'BLOCKED',
    mode: 'QUICK_EXIT',
    blocker: 'DMARKET_QUICK_EXIT_EVIDENCE_REQUIRED',
    components: {
      net_margin: { points: null, max: ECONOMIC_WEIGHTS.net_margin, evidence: 'N_D' },
      executable_buy_side_depth: { points: null, max: ECONOMIC_WEIGHTS.executable_buy_side_depth, evidence: 'N_D' },
      liquidity: { points: null, max: ECONOMIC_WEIGHTS.liquidity, evidence: 'N_D' },
      spread_exit_friction: { points: null, max: ECONOMIC_WEIGHTS.spread_exit_friction, evidence: 'N_D' }
    }
  };

  return {
    ...item,
    scoring_version: SCORING_VERSION,
    quality_score: quality.score,
    economic_action_score: economic.score,
    action_tier: deriveActionTier({
      qualityScore: quality.score,
      economicScore: economic.score,
      fresh: true,
      actionable: actionabilityBlockers.length === 0
    }),
    actionability_blockers: actionabilityBlockers,
    quality_evidence: quality,
    economic_evidence: economic
  };
}
