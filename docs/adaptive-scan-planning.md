# Bounded adaptive planning (#55)

`adaptive-scan-plan.mjs` adds cadence decisions to the #39 registry and static
integer job allocation. The production capability remains DMarket / 2021 Mirage /
Consumer, NORMAL + SOUVENIR, ten jobs. No new market or collection is activated.
Tier identities and 60/30/10 allocation do not change.

## Evidence and guards

The refresh worker reads real `tsr_run_telemetry` rows with its existing server
credential before claiming an attempt. The query selects lightweight fields only,
last 24 hours, newest first with stable ID ties, at most 360 rows (15 attempts/hour).
Each exact source / canonical collection generation / rarity / planned variant
set uses its latest 24 distinct records. Unknown collections, future/invalid
times, duplicate IDs and old collector scope semantics cannot establish a sample.

V4 telemetry records **planned variants**, including zero-result runs and errors.
V3 stored variants observed in results, so V3 cannot establish empty-scan coverage
and is deliberately excluded. The same #40 table and #48 columns suffice; no
migration, access grants, new storage, longer retention or paid infrastructure.
Existing telemetry remains preserved. A fresh V4 measurement window must form
before adaptation starts; local/CI evidence is not a claim of production yield.

Adaptation needs at least six scans spanning at least 20 minutes. Missing,
unavailable or insufficient history falls back to the static allocation and
existing 240-second pilot refresh interval. P1/P2 fallback targets are 45 minutes
and four hours; their capabilities are not enabled in the runtime.

Decision precedence, evaluated deterministically:

1. Rate-limit/error pressure in at least 1/6 of the window: cold cadence.
2. Six consecutive completed scans with measured zero certified yield: cold.
   An error or unknown certified count breaks that streak.
3. Promotion requires six completed scans spanning 20 minutes, at least 30
   candidates, certified/candidate yield >=10%, signals in at least three scans,
   a certified signal within one hour, measured economic coverage >=50%, and
   combined TREASURE/DIAMOND yield >=3 across at least three scans.
4. Otherwise, use baseline cadence. Unknown economic/actionable fields do not
   become zero and cannot establish promotion. Separate TREASURE and DIAMOND
   counts are N/D in the existing schema; `actionable_count` is their measured sum.

| Tier | Hot target | Baseline | Cold / pressure |
| --- | --- | --- | --- |
| P0 | 5 minutes; 10 if stale rate >50% or unmeasured | 15 minutes | 30 minutes |
| P1 | 30 minutes | 45 minutes | 60 minutes |
| P2 | 2 hours | 4 hours | 6 hours |

Stale rate uses measured `snapshot_age_at_start > 300`, with six age samples.
It describes the previous snapshot at scan start, not the freshness of newly
collected data. Longer cadence can intentionally produce a STALE UI. The 300s
freshness classification and captured timestamps remain truthful and unchanged.
Targets are not guarantees during sleep, backoff, HALTED state or budget limits.

## Scheduling and fairness

Next due = latest scoped attempt finish + target interval; restarts reconstruct
it from stored history. Missing-history scopes have a fixed earliest deadline.
Within a tier, oldest-due scopes receive integer remainder jobs first, retaining
the #39 equal shares and tier allocation. Once served, a scope's recorded attempt
moves it behind older unserved scopes. Each scope has a finite deadline, and cold
scopes remain eligible. A positive budget unable to allocate even one job to an
enabled tier is rejected, rather than silently starving that tier. Zero budget
means no work. Fairness requires recording attempts and sufficient execution
capacity; it cannot override unavailable adapters or global safety gates.

The worker integrates only the enabled pilot. A not-due plan returns PLANNED_WAIT
without consuming a lease/attempt. The existing bounded timer rechecks history;
once due, `tsr_refresh_claim` remains the only authority to allow collection.
No browser/API read triggers scans. Owner fencing, 180s lease, 240s minimum gap,
15 attempts/hour, durable Retry-After/backoff, explicit HALTED reconciliation and
24 COMPLETE snapshots / 128 KiB limits are untouched. Read/validation failure
falls back to this same durable claim, never an unfenced collector call.

Variant sets are indivisible scan scopes: mixed NORMAL|SOUVENIR telemetry is never
reused as a NORMAL-only or SOUVENIR-only sample. Item comparator pools and economic
enrichment remain variant-separated; the planner does not alter their evidence.

## Validation and limits

`node --test tests/adaptive-scan-plan.test.mjs` covers promotion, cold/no-signal,
pressure precedence, sample/window guards, recency, missing economics, exact scope
isolation, deterministic ordering, tier shares, remainder fairness, persisted-row
reads across worker restart, fallback, durable gates and zero-result telemetry.
The full suite retains auth, economic, freshness and registry regression tests.
CI adds `adaptive-contract` alongside validate/Chromium, registry-contract and real
Postgres durability/security tests. No manual production deployment or live
adaptive-yield verification is claimed by these tests. #55 ends at this bounded
implementation; Waxpeer, CSDeals, new collections, alerts and monetization remain
outside it.
