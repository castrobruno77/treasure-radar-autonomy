# Waxpeer read-only reference adapter — #57

## Reconciliation before implementation

Base main: `f4d53625015d16e3ea0980134cbb4d188150d2f5` (PR #56 / #55).
#57 was already closed for factual MARKET validation, not code delivery. The
subsequent explicit DIREÇÃO request authorizes this bounded implementation.
#37 separates discovery/economics/action; #38 requires identity, fee and temporal
normalization; #42 places this after #39 registry / PR #54 and #55 adaptive
planning / PR #56. #48 DMarket economics remains the certified scoring path.
This work does not change thresholds, active collector capabilities or scheduling.

## Capability and integration boundary

`backend/waxpeer.mjs` implements `createWaxpeerClient().publicSnapshots()`:

- GET `/v1/prices/snapshot?format=csv&game=csgo&include_hold=1&include_manual=1`;
- GET `/v1/buy-orders/snapshot?game=csgo`;
- no public request carries a key, even if one is configured for the separate
  future exact-float method; GET-only fixed routes, redirects refused;
- ten-second request deadline; at most 32 MiB decoded bytes per response;
- CSV streaming stops at 1,000 complete listing rows, cancelling the response.
  This is explicitly `BOUNDED_PREFIX_NOT_FULL_SNAPSHOT`, not full market coverage
  or random sampling. The source sorts by item ID, not by opportunity quality;
- best-bid JSON is bounded to 100,000 rows and the same byte ceiling; over-limit,
  malformed or source-error responses fail closed without partial certification;
- no automatic retry; HTTP errors establish client-local backoff, honoring
  Retry-After with a one-second floor (60s fallback). Reuse the client while
  testing; this is not durable distributed rate scheduling and global source
  rate limits remain N/D. No new recurring polling is enabled.

CSV fields are read by header, with quoted commas/newlines/escaped quotes and
append-only columns supported. Preserve item_id, full market hash name, integer
price, inspect data, auto/delivery, unlock_at/send_until and class/instance IDs.
No inspect URL is fetched or decoded into float. Empty metadata is null, not zero.
Public account/merchant identity columns unnecessary for this purpose are omitted.
Best bids preserve name, max/raw price, timestamp and public buyer ID. Any extra
amount/depth/certification flags in a public response cannot become executable
quantity: best_bid_qty and depth fields remain null.

`createWaxpeerCatalog(entries)` consumes explicit item membership with an evidence
reference and observation time, resolving collection aliases via #39. It accepts
only canonical Phase A rarities and exact variant-tagged market names. Duplicate
names with ambiguous membership reject. It does not guess membership from text,
remove years, merge wear titles or strip Souvenir/StatTrak prefixes. The registry
alone is not an item catalog; absent membership leaves collection/rarity N/D and
blocks the economic join. No production catalog membership is fabricated here.

`waxpeerCrossCheck` returns a distinct #38 QUICK_EXIT_REFERENCE; it does not mutate
an opportunity or score. `crossCheckWaxpeerOpportunity` supports a DMarket ask only
when its explicit collection/rarity/variant agrees with the evidence-backed catalog
and the bid identity. Catalog mappings used in unit tests are explicitly synthetic.
Normal/Souvenir/StatTrak, legacy/2021 Train, conflicting generations and rarities
have separate/blocked joins. The existing production feed is not expanded.

## Money, time and prohibitions

Money is integer USD-thousandths, including CSV zero padding; `/1000` gives USD.
Raw integer and scale remain available for audit. FX is 1; FX timestamp is N/A.
Reject fractional/unsafe/missing/negative money. A bid is a name-level reference,
not float- or phase-targeted demand.

Both absolute observation age and ask/bid skew must be <=180s, with <=60s preferred.
Tests include 60/180 exactly and one millisecond above. Old aligned pairs, future
or missing timestamps cannot bypass the gate. Source-native bid time is separate
from ingestion time. CSV has no source snapshot timestamp: its timing basis is
explicitly observed-only, with source age unknown. HTTP/cache freshness is not
invented, and no certified exit follows from this weaker basis.

Every cross-check stays SOURCE_VALIDATING / BID_DEPTH_PARTIAL / FEES_PARTIAL.
The documented 6% seller percentage is a dated baseline, never FEES_KNOWN.
`balance_after_standard_percentage_fee_usd` is only bid ×94% to reusable balance,
not certified net: seller fixed, buyer/funding and withdrawal fees remain N/D.
Acquisition cost, net exit, profit and net margin therefore remain null. Track
approximately seven-day cash-withdrawal hold and listing delivery/lock friction
separately; do not turn conditional penalties into universal fees.

No BID_EXECUTABLE, SOURCE_VALIDATED, SALES_EXECUTED or full-depth claim is emitted.
Cross-check action_tier is BLOCKED and economic_action_score is null.
`applyEconomicScoring` additionally rejects COMPLETE evidence from an exit source
other than DMarket (including an accidentally relabeled Waxpeer reference).
Existing DMarket tests and weights/thresholds remain intact.

## Exact-float preparation, disabled by default

`client.exactFloat(listing)` is a separate future read capability. It makes zero
requests unless the caller explicitly supplies both
`WAXPEER_EXACT_FLOAT_AUTHORIZED=true` and an existing `WAXPEER_API_KEY` via env.
The default client uses no environment credentials. This implementation does not
create, seek, inspect or configure a credential, and the one-shot probe never
calls this method. No key is required for public ingestion.

When independently authorized later, GET `/v2/get-items-list` uses documented
query authentication and cursor pagination, at most three pages of 100. Match
item_id AND exact full name AND raw price; require factual numeric float in [0,1]
and join age <=180s. No match, invalid/cyclic cursor, page ceiling, stale listing
or transport error returns N/D. This is a bounded lookup, not a complete float
inventory. The returned evidence is separate, with endpoint and observed_at;
source_timestamp stays null because the endpoint has no documented per-item time.
Errors never include URLs, source bodies or credentials. No float is inferred
from names, inspect links, wear classes or heuristics.

## Evidence and verification

Official source references reviewed against #57:

- [Listing snapshot](https://docs.waxpeer.com/api/buy-items/prices-snapshot): CSV header, units, lock/delivery, optional auth and render 429.
- [Best-buy-order snapshot](https://docs.waxpeer.com/api/buy-order/buy-orders-snapshot): offers/name/max/by and source timestamp, no quantity.
- [Exact-float v2](https://docs.waxpeer.com/api/steam/get-items-list-v2): authenticated item shape and cursor limits.
- [Seller fee](https://faq.waxpeer.com/faq/fees-sell): 6% standard percentage.
- Remaining cash-out, depth and fee qualifications follow factual contract #57.

The listing documentation itself describes differing refresh/cache frequencies
in different sections; the adapter does not use those descriptions as timestamps.

One-shot verification: `node scripts/check-waxpeer-reference.mjs`. It reports
counts/status only, loads no key, persists no listings and schedules no work.
Observed public probe: listing ingestion `2026-10-09T02:03:33.069Z`, bid source
timestamp `2026-10-09T02:03:21.000Z` (2026-10-08 in America/Sao_Paulo). It returned
1,000 bounded-prefix listings and 6,766 bids, SOURCE_VALIDATING, no forbidden
flags. All 1,000 economic joins blocked because no membership catalog was supplied;
exact-float N/D because not authorized/requested. This proves public read/parser
compatibility for the observed sample, not broad identity coverage or execution.
The first bounded full-response attempt failed; a later sample exposed non-skin
Souvenir-package names and prompted a prefix-only variant parsing correction.

`tests/waxpeer.test.mjs` covers units, CSV/bid schemas, lock/unknown metadata,
limits/backoff, 60/180 gates, partial fees/depth, non-promotion, variants/generations,
catalog uncertainty, key/authorization gates, factual float joining and pagination.
CI `waxpeer-contract` adds DMarket/scoring/registry regressions; the full CI retains
Chromium, adaptive contracts and real PostgreSQL durability/access checks.

No deploy is required for this read-only capability's implementation proof. No
production adaptive/scoring rollout is claimed. Rollback: revert this PR; no data
migration, secrets or infrastructure changes need reversal.

## Final boundary / next canonical gate

This completes only the bounded SOURCE_VALIDATING adapter implementation, not
certified Waxpeer QUICK EXIT or Coverage Beta. Before any promotion: explicit
authorization for authenticated evidence, proved remaining executable quantities/
depth and fees/cash-out semantics, a factual membership mapping, approved polling
limits, and runtime float/bid alignment evidence per #57/#38. Any deployment or
activation remains a separate decision. STOP: no CS.Deals, new markets/collections,
alerts, monetization, trading, auto-buy or contract EV work follows automatically.
