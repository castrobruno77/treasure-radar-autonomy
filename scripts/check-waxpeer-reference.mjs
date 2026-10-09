// Explicit one-shot public read, never a scheduler or production feed promotion.
// Does not load env credentials, request exact float, persist listings or trade.
import { createWaxpeerClient } from '../backend/waxpeer.mjs';

try {
  const snapshot = await createWaxpeerClient().publicSnapshots();
  console.log(JSON.stringify({ source: snapshot.source, source_status: snapshot.source_status,
    version: snapshot.version, listings: snapshot.listings.length, bids: snapshot.bids.length,
    listing_coverage: snapshot.listing_coverage,
    listing_observed_at: snapshot.listings[0]?.observed_at ?? null,
    bid_source_timestamp: snapshot.bids[0]?.source_timestamp ?? null,
    exact_float_status: 'N_D_NOT_AUTHORIZED_OR_REQUESTED',
    catalog_status: 'N_D_NO_ITEM_MEMBERSHIP_CATALOG',
    economic_references_blocked: snapshot.cross_checks.filter(x => x.status === 'BLOCKED').length,
    forbidden_flags_found: [...snapshot.listings, ...snapshot.bids, ...snapshot.cross_checks]
      .some(x => x.confidence_flags.some(flag => ['BID_EXECUTABLE', 'SOURCE_VALIDATED'].includes(flag))) }));
} catch (error) {
  console.error(JSON.stringify({ source: 'WAXPEER', source_status: 'SOURCE_VALIDATING',
    status: 'READ_UNAVAILABLE', reason: /^WAXPEER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'WAXPEER_READ_UNAVAILABLE',
    retry_at: Number.isFinite(error.retryAt) ? new Date(error.retryAt).toISOString() : null }));
  process.exitCode = 1;
}
