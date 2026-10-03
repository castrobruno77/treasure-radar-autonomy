# Bounded next cycle

All work keeps ZERO COST MODE, existing collection/rarity and comparator. No billing, auto-buy, new secrets, paid infrastructure or economic threshold changes. Every material change updates CONTINUITY.md and follows branch -> CI -> PR -> merge.

| Issue | Scope | Exit condition |
| --- | --- | --- |
| #13 | API + bounded real DMarket adapter + durable local snapshot + extension connection | Real scan passes actual HTTP/client smoke and tests; this release |
| #15 | Four-source initial validation + Steam auth architecture | Evidence/status per source, explicit auth/security acceptance; this release |
| #14 | GATE: authorized Supabase writes | Reviewed schema applied, RLS/anon denial and write/readback proven; no bypass of read-only connection |
| #16 | GATE: authenticated zero-cost remote promotion | Existing runtime access/cost verified, durable sessions, real Steam callback, rollback and cloud E2E smoke |

Before #16, review trade-up eligibility of the legacy Normal/Souvenir comparator pool. Preserve current rule in the diagnostic pilot; any economic change requires sourced evidence and the existing business gate. CS.Deals/Waxpeer stay VALIDATING until price units, stable IDs, pagination, exact float/catalog mapping and comparator coverage are proved. CSFloat stays BLOCKED until authorized access works.

Safe next execution after this release: finish source normalization fixtures and eligibility evidence without market expansion or production writes, then implement/test Steam verification offline against the documented contract. Remote enablement waits for #14/#16. Bound each PR to one acceptance group and do not repeatedly probe blocked sources.
