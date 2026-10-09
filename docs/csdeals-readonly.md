# CS.Deals bounded read-only adapter — #59

Contract: #59; economics #38; governance #37/#42; identity #39; dependencies
#55/#57. #62/#63/#64 are factual validation inputs, not P0 activation authority.
Base main: `01581abb26e3228db9d371004c12c48e87acc607`.

`backend/csdeals.mjs` exposes only GET listings, sales averages and exact-name
sales. Fixed HTTPS origin, Bearer header, redirects forbidden, 15s timeout,
12MB response cap, bounded pages and per-endpoint pacing/backoff. Both explicit
read authorization and a configured existing key are required. No HTTP bodies,
headers or transport exceptions are included in errors. The scheduler/feed do
not import this module; there is no autonomous collection activation.

The adapter-local `csdeals-catalog.json` mechanically transcribes #63's 70 rows
(39 Consumer / 31 Industrial) with evidence URLs, float bounds and variant
provenance. It only validates this bounded adapter/probe. It does not supply
capabilities to the planner or change DMarket/Waxpeer behavior. #39 aliases retain
generations. Native collection and rarity must match; unknown literals fail
closed for review against #64. StatTrak remains separately parsed but rejected
for every catalog row. Souvenir requires explicit flags plus catalog provenance.

Listings require stable ID, Steam asset ID, price, factual exact float, inspect,
wear and identity. `created_at` remains listing creation, never snapshot time;
`observed_at` is ingestion time, source timestamp unknown. Missing lock data is
null. Listing rejection counts do not imply catalog absence. Historical rows
join by exact name/wear/variant to unique canonical membership; they do not have
float, listing ID or native collection proof. No inferred float premium.

## Historical reference guards

All prices are integer USD cents divided by 100. PATIENT_RESALE uses the source's
30-day volume-weighted average, never an executable order or invented median.
Conservative adapter-local guards: at least 5 separate sales and 5 copies in the
average; at least 3 distinct price/quantity/time tuples in the bounded newest
100 sale rows, inside the average's 30-day window; a qualifying sale no older
than 7 days. Equal tuples cannot establish distinct sales because REST has no
sale ID. All evidence observations must be <=180s old, aggregate generation
<=900s old (source cache is 600s), no future dates. These guards are reference
eligibility, **not canonical production scoring thresholds or proof of full
30-day sample completeness**. Missing/invalid/insufficient evidence is BLOCKED.

`SALES_EXECUTED` describes factual sold order lines and the executed-sale average.
Official averages docs distinguish exclusion of refunded/failed orders from
the recent `/sales` route. Recent rows therefore carry
`SALE_SETTLEMENT_UNVERIFIED`; they are not asserted to be settled cash proceeds.
Buyer 0%, seller 2% are the published marketplace percentages, only FEES_PARTIAL.
Fixed, funding and withdrawal fees remain null. A separate balance-after-known-
percentage reference is not net exit, acquisition cost, profit or cash-out net.

Every output stays SOURCE_VALIDATING. No QUICK_EXIT, BID_EXECUTABLE or
SOURCE_VALIDATED is generated; bid fields null/false, action tier BLOCKED and
economic score null. Existing scoring rejects a forged CSDEALS COMPLETE exit.
Consequently this unit cannot certify a second production-grade economic source.

## Live validation and recovery

Run `node scripts/check-csdeals-reference.mjs` only as an explicit one-shot
authorized runtime probe. It reads at most ten 500-row listing pages, one
averages response and six 100-row exact-name sale pages, respecting pacing.
It emits one safe JSON record with response hashes/times, bounded examples,
native mapping observations, guards and limitations. It never logs the key or
persists raw payloads. A prefix miss does not prove market/catalog absence.

Credential configuration: `CSDEALS_API_KEY: existing Railway secret referenced
by scale-scheduler`. Configure only a Railway service-variable reference to the
existing `scale-runtime-market` variable; never copy a resolved value. For live
proof, use a temporary pre-deploy command on the existing scale-scheduler,
deploy a reviewed CI-PASS commit and then remove the command. No new service,
resource scaling, paid service or cron is required. Final run/deployment IDs,
head/merge/CI and observed results belong in #59/#42; until recorded, live
validation must be considered pending.

Rollback: clear the temporary pre-deploy command; restore the prior pinned
runtime commit `91c5fc6c1357e4c88eec69e51e7ae4f55007732a` / deployment
`a85004e9-e91e-43a6-9dda-1bc5860cf7b6` if runtime recovery is needed. Remove only
the newly added scheduler reference if rolling back credential access. Never
delete the source secret. Revert this PR to remove adapter code. No schema or
persisted feed migration is involved.

STOP: no P0 activation, Phase 4, Opportunity History #60, Saved Filters #61,
Alert Engine #41, WebSocket, trading, monetization or next market.

Primary source references checked 2026-10-09:
- https://cs.deals/docs/reference/market-data/listings
- https://cs.deals/docs/reference/market-data/sales
- https://cs.deals/docs/reference/market-data/sales-averages
- https://cs.deals/docs/reference/market-data/overview
- https://cs.deals/fees
