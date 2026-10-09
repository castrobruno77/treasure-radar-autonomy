# Canonical collection registry (#39)

`backend/collection-registry.mjs` implements the product contract in issue #39.
The registry contains the eight P0 collections, P1 (including separate legacy
and 2021 Train records), and the four named P2 collections. Additional unnamed
collections are not admitted. Canonical names and stable IDs resolve by an
explicit, collision-checked alias table; only case and whitespace are normalized.
Years are never stripped. Bare Mirage/Vertigo and their legacy canonical names
are rejected. Nuke, Train and Overpass resolve to their legacy canonical names;
2021 Train has a distinct ID. Unknown generations fail closed.

Consumer Grade and Industrial Grade are the Phase A **policy scope**, not an
assertion that every collection has both rarities or source coverage. Every scan
also requires an explicit collector capability for its collection and rarity.
Only the existing DMarket Mirage 2021 / Consumer collector is enabled. Industrial
and other collections remain unavailable to the runtime until verified adapters
exist. The registry is not an item membership catalog.

## Static planning and runtime contract

`backend/scan-plan.mjs` allocates a bounded integer job budget using P0/P1/P2
weights 60/30/10, largest remainders with tier-order ties, then equal allocation
within each tier, with Consumer before Industrial and ID order for ties. Missing
tiers redistribute their share among available tiers. No capabilities means no
jobs. Duplicate aliases for a scope are rejected rather than doubling budget.
This is deterministic per-call allocation, not adaptive cadence or temporal fairness.

`collectScan` consumes `pilotScanPlan()` for the canonical query and job count;
`normalizeScan` verifies the returned scope against that same registry-backed
plan before publishing anything. Existing 10-job budget, source, revision gate,
economics, freshness and auth remain unchanged. Aliases in responses canonicalize;
legacy/different-generation, rarity and variant conflicts reject the whole scan.
Collection candidate/certified yield continues through existing #40 telemetry
using the canonical collection name, without a database migration.

## Variant boundaries and evidence limits

Normal, Souvenir and StatTrak have distinct comparator pool identities (source,
canonical collection ID, rarity, variant and item name). Souvenir is permitted
only for the existing price-signal capability and is rejected for trade-up.
StatTrak requires explicit collection/rarity capability support; no production
capability enables it. Variant-prefixed skin names are rejected to avoid double
prefixing or cross-variant title queries. DMarket economics retains exact-title
matching and separate calls for Normal/Souvenir titles.

The legacy service returns aggregate comparator evidence, not individual peers.
Its pinned OPS045 revision remains the trust boundary. Contradictory comparator
dimensions, when supplied, now reject the scan. Local tests prove canonical
planning, request/response validation and variant identities; they do not audit
unreturned peers or prove live coverage of every registry collection.

## Verification

Run `node --test tests/*.test.mjs` and `node scripts/validate.mjs`.
CI additionally has a named `registry-contract` job covering registry and real
collector code with injected HTTP responses, plus existing database and Chromium
checks. Tests need no network, credentials or deployment. Exact PR/head/merge
and CI evidence belong in issue #39 and roadmap #42. No production deployment
is required for this bounded implementation proof; production activation is
not claimed by these offline contracts.

Adaptive cadence is added by [the bounded #55 planner](adaptive-scan-planning.md),
which consumes this registry and preserves tier shares. New markets, monetization,
alerts and auto-buy remain outside these implementations.
