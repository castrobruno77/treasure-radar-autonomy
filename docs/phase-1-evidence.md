# Phase 1 evidence — 2026-10-03

## Recovery audit

Read Drive document 05 and repository CONTINUITY.md first. Both named healthy main `39517446f4ea80eac27202f916205d8283e5cf6c`. No open issues/PRs existed at recovery. Latest inspected Health Watch run `37147497542` succeeded. Direct `/health` confirmed `OPS045_ROBUST_COMPARATOR_V1`.

Automation view calls for Auto Dev, Fallback and Continuity Sync rendered cards but exposed no enabled/disabled fields to the agent. Their current execution state is therefore **unverified**, not inferred from the historical enabled state in Drive. No local automation.toml files were found. No duplicate automations were created. Health Watch is independently verified through GitHub.

## Markets

Sanitized `/probe?source=all` at 21:24 UTC:

| Source | Transport evidence | Status for TSR | Remaining validation |
| --- | --- | --- | --- |
| DMarket | HTTP 200, 100 rows, price/float/seed/index/inspect | VALIDATED for existing bounded OPS045 comparator adapter only | Listing deep link and trade-up eligibility review; not global market validation |
| CS.Deals | HTTP 200, 500 rows, price/float/seed/index/inspect; rate limit 1, remaining 0 | VALIDATING; excluded from feed | Verify documented currency units, cursor/rate handling, exact collection/rarity mapping, bounded comparator evidence |
| Waxpeer | HTTP 200, 100 rows, price/float; no timestamps/inspect in sample | VALIDATING; excluded from feed | Verify fixed currency units (do not reuse legacy magnitude heuristic), capture freshness and deep links, bounded comparator evidence |
| CSFloat | One documented public GET with limit=1 returned HTTP 403 | BLOCKED; excluded from feed | Authorized access/rate-policy verification; no retry, scraping workaround or key creation |

CSFloat official docs: https://github.com/csfloat/docs/blob/main/source/index.html.md. Documented API access and runtime access are distinct; 403 does not prove a missing API key is the sole cause.

Live bounded scan at 21:25 UTC: 10 planned/completed jobs, zero errors, 528 listings, 53 candidates, 1 CERTIFIED_SURVIVOR, 50 rejected, 2 insufficient. Robust summary is PARTIAL because two candidates lack evidence; completed individual certified classifications remain distinct. Second scan through the new collector at 21:30 UTC persisted 53 candidates / 1 certified. Actual timestamps are kept in `.data/latest.json`; ephemeral listings are not a permanent recommendation.

The surviving signal was Souvenir MAC-10 | Sienna Damask at $0.33, with 47 peers and 42.11% gap. No listing URL was provided. No URL is fabricated. The legacy comparator pools Normal and Souvenir; this cycle preserves that approved behavior but **does not revalidate trade-up eligibility**. API/UI explicitly mark this as a pilot. Eligibility must be resolved before production/actionable alerts; do not interpret CERTIFIED as guaranteed economic suitability.

## Persistence and release boundary

Supabase read found no `public.tsr_*` tables. An additive RLS-protected `tsr_runs` migration was attempted once and refused while initializing migration history: `25006 cannot execute CREATE SCHEMA in a read-only transaction`. No bypass or alternate write channel used. Proposal: `docs/tsr-schema-proposal.sql`; not applied or tested against a writable database. Supabase security reference: https://supabase.com/docs/guides/api/securing-your-api

Local fallback persists the latest complete snapshot atomically and survives process restarts. It is not Supabase persistence, a complete run history, or a scheduled cloud service. Shared in-memory deployment or ephemeral disk must not be presented as durable production storage.

Plugin discovery found no Deno deployment tool. No deployment credential is configured by this change, no new infrastructure is provisioned, and cost-free production deployment is not verified. Existing Deno runtime remains unchanged. The API handler uses Web Request/Response and can be hosted on Deno after the persistence/auth/deployment gates; the local launcher uses Node built-ins.

Validation: existing extension checks plus adapter rejection cases, strict query bounds, age, missing scan, atomic write/read after store recreation, cross-process lock and HTTP -> actual extension API client. Native Chrome/Edge installation and popup rendering remain a separate manual smoke; do not claim they were performed by these tests.
