import { planScans } from './scan-plan.mjs';
import { resolveCollection } from './collection-registry.mjs';

export const PLANNER_VERSION = 'ADAPTIVE_SCAN_V1';
export const TELEMETRY_SCOPE_VERSION = 'TREASURE_RADAR_DMARKET_V4_PLANNED_SCOPE';
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TELEMETRY_ROWS = 360; // #33: at most 15 attempts/hour.
const MIN_SCANS = 6;
const MIN_SPAN_MS = 20 * 60 * 1000;
const CADENCE = Object.freeze({ P0: [300, 900, 1800], P1: [1800, 2700, 3600], P2: [7200, 14400, 21600] });
const count = n => Number.isSafeInteger(n) && n >= 0;
const sum = (rows, field) => rows.reduce((n, r) => n + r[field], 0);
const measured = (rows, field) => rows.length > 0 && rows.every(r => count(r[field]));
const key = s => JSON.stringify([s.source, s.collection_id, s.rarity]);
const enough = rows => rows.length >= MIN_SCANS &&
  Date.parse(rows[0].started_at) - Date.parse(rows.at(-1).started_at) >= MIN_SPAN_MS;

function scopedRows(rows, scope, now) {
  const seen = new Set();
  return rows.filter(r => {
    if (!r || r.source !== scope.source || r.rarity !== scope.rarity ||
        r.collector_version !== TELEMETRY_SCOPE_VERSION ||
        r.variant_scope !== scope.variants.join('|') || !['COMPLETE', 'ERROR'].includes(r.status)) return false;
    try { if (resolveCollection(r.collection).id !== scope.collection_id) return false; } catch { return false; }
    const started = Date.parse(r.started_at), finished = Date.parse(r.finished_at);
    return Number.isFinite(started) && Number.isFinite(finished) && finished >= started &&
      finished <= now && started >= now - WINDOW_MS && typeof r.id === 'string' && r.id.length > 0;
  }).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id))
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; }).slice(0, 24);
}

// Changes cadence only: canonical tier identity and the #39 integer job shares
// remain structural floors. Every emitted scope has a finite next due time.
export function adaptiveScanPlan({ budget, capabilities, telemetry = [], now = Date.now() }) {
  if (!Number.isFinite(now) || !Array.isArray(telemetry) || telemetry.length > MAX_TELEMETRY_ROWS)
    throw new Error('INVALID_PLANNER_INPUT');
  // Validate the requested budget even when there are no capabilities.
  const staticPlan = planScans({ budget, capabilities });
  const decisions = planScans({ budget: 10000, capabilities }).map(scope => {
    const rows = scopedRows(telemetry, scope, now);
    const complete = rows.filter(r => r.status === 'COMPLETE');
    const last = rows.length ? Date.parse(rows[0].finished_at) : null;
    const [hot, normal, cold] = CADENCE[scope.collection_priority_tier];
    let interval = scope.collection_priority_tier === 'P0' ? 240 : normal;
    let reason = 'STATIC_INSUFFICIENT_TELEMETRY';
    let streak = 0;
    for (const r of rows) {
      if (r.status !== 'COMPLETE' || r.certified_count !== 0) break;
      streak++;
    }
    const candidates = measured(complete, 'candidate_count') ? sum(complete, 'candidate_count') : null;
    const certified = measured(complete, 'certified_count') ? sum(complete, 'certified_count') : null;
    const economic = measured(complete, 'economic_scored_count') ? sum(complete, 'economic_scored_count') : null;
    // #48 persists combined TREASURE/DIAMOND yield; separate counts are N/D.
    const actionable = measured(complete, 'actionable_count') ? sum(complete, 'actionable_count') : null;
    const ages = complete.filter(r => count(r.snapshot_age_at_start));
    const staleRate = ages.length >= MIN_SCANS ? ages.filter(r => r.snapshot_age_at_start > 300).length / ages.length : null;
    const pressure = rows.filter(r => r.rate_limit_hit === true || r.status === 'ERROR').length / (rows.length || 1);
    const signal = complete.find(r => count(r.certified_count) && r.certified_count > 0);
    const recentSignal = signal ? now - Date.parse(signal.finished_at) <= 60 * 60 * 1000 : false;
    if (enough(rows)) {
      interval = normal;
      reason = 'BASELINE';
      if (pressure >= 1 / MIN_SCANS) { interval = cold; reason = 'RATE_OR_ERROR_PRESSURE'; }
      else if (streak >= MIN_SCANS) { interval = cold; reason = 'NO_SIGNAL_STREAK'; }
      else if (enough(complete) && candidates >= 30 && certified / candidates >= 0.1 &&
          recentSignal && complete.filter(r => r.certified_count > 0).length >= 3 &&
          economic !== null && economic / candidates >= 0.5 && actionable !== null && actionable >= 3 &&
          complete.filter(r => r.actionable_count > 0).length >= 3) {
        // A stale-heavy window never receives the fastest P0 target. Staleness
        // is observed at scan start, not a claim of bad newly collected data.
        interval = scope.collection_priority_tier === 'P0' && (staleRate === null || staleRate > 0.5) ? 600 : hot;
        reason = 'RECENT_ACTIONABLE_YIELD';
      }
    }
    // A never-scanned scope must not move its deadline forward on every call.
    const due = last === null ? 0 : last + interval * 1000;
    return Object.freeze({ ...scope, planner_version: PLANNER_VERSION, interval_seconds: interval,
      reason, next_due_at: new Date(due).toISOString(), wait_ms: Math.max(0, due - now),
      metrics: Object.freeze({ scans: rows.length, completed_scans: complete.length,
        certified_yield: candidates > 0 && certified !== null ? certified / candidates : null,
        actionable_yield: candidates > 0 && actionable !== null ? actionable / candidates : null,
        economic_coverage: candidates > 0 && economic !== null ? economic / candidates : null,
        stale_rate: staleRate, error_pressure: pressure, no_signal_streak: streak,
        last_signal_at: signal?.finished_at ?? null }) });
  });
  // A budget too small to give an enabled tier even one job cannot meet the
  // structural floor. Reject that configuration instead of silently starving it.
  if (budget > 0 && decisions.some(s => !staticPlan.some(p => p.collection_priority_tier === s.collection_priority_tier)))
    throw new Error('SCAN_BUDGET_CANNOT_SERVE_ENABLED_TIERS');
  const byKey = new Map(decisions.map(s => [key(s), s]));
  const allocation = planScans({ budget, capabilities, compareScopes: (a, b) =>
    byKey.get(key(a)).next_due_at.localeCompare(byKey.get(key(b)).next_due_at) });
  return Object.freeze(allocation.map(s => Object.freeze({ ...byKey.get(key(s)), jobs: s.jobs })).sort((a, b) => a.next_due_at.localeCompare(b.next_due_at) ||
    a.collection_priority_tier.localeCompare(b.collection_priority_tier) ||
    a.collection_id.localeCompare(b.collection_id) || a.rarity.localeCompare(b.rarity)));
}
