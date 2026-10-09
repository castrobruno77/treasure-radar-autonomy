# Bounded next cycle

Current bounded unit (2026-10-09): #59 CS.Deals read-only SOURCE_VALIDATING.
See `docs/csdeals-readonly.md` and `CONTINUITY.md`. #62/#63/#64 are validation
inputs, not activation. Close with exact CI/merge/live evidence on #59/#42;
STOP before P0 activation, Phase 4 or any next issue. The queue below is historical.

## Current executable queue after infrastructure recovery

- #18: offline normalizers and seven regression tests merged in PR #24. Finish authoritative eligibility/full source-pagination evidence; keep both sources VALIDATING and excluded from feed. This remaining evidence work is not a new credential or production gate.
- #19: implement injected HTTP/storage verifier and session interfaces with offline replay, expiry and binding tests. Existing login routes stay closed. No live Steam credential needed for offline work.
- #21: implement injected tsr_runs persistence/readback with database-error and atomic-local-fallback tests. Use the existing authorized connection only for any later live check. Never invent a credential or imply broader schema validation.
- #16: remote authenticated promotion remains HUMAN_GATE. #14 is closed for validated public.tsr_runs only.

Current infrastructure recovery evidence and worker/watchdog boundaries: docs/autonomy-recovery.md. Historical planning below is retained as history; it does not reopen #14.

All work keeps ZERO COST MODE, existing collection/rarity and comparator. No billing, auto-buy, new secrets, paid infrastructure or economic threshold changes. Every material change updates CONTINUITY.md and follows branch -> CI -> PR -> merge.

| Issue | Scope | Exit condition |
| --- | --- | --- |
| #13 | API + bounded real DMarket adapter + durable local snapshot + extension connection | Real scan passes actual HTTP/client smoke and tests; this release |
| #15 | Four-source initial validation + Steam auth architecture | Evidence/status per source, explicit auth/security acceptance; this release |
| #14 | GATE: authorized Supabase writes | Reviewed schema applied, RLS/anon denial and write/readback proven; no bypass of read-only connection |
| #16 | GATE: authenticated zero-cost remote promotion | Existing runtime access/cost verified, durable sessions, real Steam callback, rollback and cloud E2E smoke |

Before #16, review trade-up eligibility of the legacy Normal/Souvenir comparator pool. Preserve current rule in the diagnostic pilot; any economic change requires sourced evidence and the existing business gate. CS.Deals/Waxpeer stay VALIDATING until price units, stable IDs, pagination, exact float/catalog mapping and comparator coverage are proved. CSFloat stays BLOCKED until authorized access works.

Safe next execution after this release: finish source normalization fixtures and eligibility evidence without market expansion or production writes, then implement/test Steam verification offline against the documented contract. Remote enablement waits for #14/#16. Bound each PR to one acceptance group and do not repeatedly probe blocked sources.
