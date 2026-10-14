# DMarket P0 activation — #75

## Reconciled baseline

On 2026-10-13, remote main is `bc28c50e8572cbee741aa8766a03911b9087bf7b`.
Railway `scale-scheduler` uses that commit, `main`, an empty pre-deploy command,
one sleeping replica, and has no staged changes. The environment has no staged
patch. `scale-runtime-market` remains the suspended function after #73 cleanup.

#42's revised single-production-source definition supersedes #62's historical
two-source requirement. #63 establishes 70 identities, #64 their source mapping;
neither proves runtime activation. #55's planner and #33's deployed 240-second
minimum gap / 180-second lease / 15 attempts per hour remain authoritative.
#36/#37/#38 economics and #43 precedence are unchanged.

The runtime remains Mirage 2021 / Consumer only. `RefreshCoordinator.scanPlan`
returns a scope, but `createRefreshWorker` only consumes its wait time. Collection
still calls the pinned legacy collector through `pilotScanPlan`. Expanding a
capability array alone would falsely claim coverage.

## Native evidence prerequisite

#64 explicitly leaves Consumer/Industrial `attributes.cs2.quality` enum literals
pending live observation. No production admission rule should guess these values.
The existing Railway DMarket credentials are configured, but the connected OAuth
tool only returns variable names. An unsigned local offers read returned 401;
this is not evidence that the existing credentials fail.

`scripts/check-dmarket-p0.mjs` is an explicit, read-only probe intended to run with
the existing credentials in the deployed environment after exact-head review,
CI, merge and deployment of the merged revision. It is not imported by the server
or scheduler. It writes no database state and performs no trading operations.

The probe makes at most 24 signed GET requests (16 cells / 24 allowed variant
scopes), five offers per request, at most 1 MiB per response and 90 seconds total.
It stops at the first HTTP rejection; it never retries a rate limit. It observes
the first canonical item of each cell, so empty samples do not establish absence.
It preserves the original response hash, safe identity observations and rejection
counts, never raw responses, credentials or account fields.

The documented v2 envelope is `items`; category uses enum strings while filter
values are lowercase. Float and cents may be decimal strings. Reference:
https://docs.dmarket.com/v1/swagger.html#tag/Buy-items/operation/GetMarketplaceOffersV2

All observations explicitly remain `OBSERVED_NOT_CERTIFIED`. This increment does
not activate production cells and cannot close Coverage Beta. The catalog is
reused from the existing #63 transcription; CS.Deals remains reference-only.

## Remaining #75 exit work

1. Capture and reconcile native rarity/provenance observations.
2. Implement bounded native collection and pass the actual #55 selection through
   collection, publication and error/success telemetry.
3. Test all 16 cells, generation/variant isolation, fairness, sparse results,
   auth/freshness/rate-limit policy and unchanged economic scoring.
4. CI and approval at the exact final head; merge and deploy that merged revision.
5. Observe all 16 cells exercised by the production planner; expose DMarket-only
   concentration explicitly. Empty/thin results remain valid.

Current decision: **PARTIAL — production activation and planner proof pending**.
Rollback for this preparatory increment: revert its commit; production behavior
is unchanged. No migration, automation change, new credential or new cost.
