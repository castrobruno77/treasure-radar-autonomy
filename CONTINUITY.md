# Treasure Skins Radar — Continuity & Recovery

This file is the repository-side cold-start entry point. Do not rely on a previous chat's memory.

## Recovery command for Bruno

Open a new chat in the **Corporação** project and send:

> Retome o Treasure Skins Radar pelo documento `05 — CONTINUITY & RECOVERY — CURRENT STATE` no Drive e pelo `CONTINUITY.md` do repositório `castrobruno77/treasure-radar-autonomy`. Reconstrua o estado pelas fontes de verdade, verifique automações/health/backlog e continue do próximo passo seguro. Não dependa da memória do chat anterior.

## Sources of truth

- **Drive:** human canonical documentation.
- **GitHub:** code, versions, CI, PRs and rollback.
- **Supabase:** operational persistence state. Gate #14 is reconciled and closed as technically unblocked through validated `public.tsr_runs`; verify observable evidence before claiming broader `tsr_*` coverage.
- **ChatGPT Project:** context and specialists; not authoritative state.

Drive folder: `TREASURE SKINS RADAR`  
Drive folder ID: `1krO8gn-L8l83Q3xvbGoKjCxm7iF-nrSb`  
Continuity document ID: `1v2Z5r4Kb_CY4BVjcuq8vYg18lmVDBcCEX4hAXjw1Zak`

## Current checkpoint

### #33 recurring freshness — implementation checkpoint

The user confirmed the initial remote feed online with a real Steam session and
authorized recurring zero-cost freshness through production validation. Issue #33
adds an opt-in loop on the existing Railway runtime with database TTL/lease,
owner-fenced publication, shared cooldown/hour budget, backoff/Retry-After, and
bounded tsr_runs retention. Steam Auth is unchanged. See
[recurring freshness](docs/recurring-freshness.md) for bounds, schema, rollout,
sleep/quota limitations and rollback. Keep #33 open until production evidence,
including two advancing complete captures across TTL, is recorded.

### Authenticated feed 503 diagnosed — 2026-10-05

Live Railway logs confirm successful Steam start/callback/exchange followed by feed
503. Read-only Supabase inspection confirms `tsr_runs` is empty with the expected
schema, RLS and server-only grants. Remote startup reads but never populates this
table, producing `NO_SUCCESSFUL_SCAN`; authentication does not need replacement.
The earlier missing-key/fail-closed checkpoint below is historical: the live login
has since succeeded. The current branch adds explicit, one-shot, empty-database
feed preparation with strict durable persistence and offline regression coverage.
See [diagnosis and controlled redeploy](docs/authenticated-feed-recovery.md) for
the exact target, gates, limitations and rollback. No production deployment or
database mutation is part of this repair's validation; merge requires exact-head CI.

### #16 zero-cost Railway runtime live, fail-closed — 2026-10-05

Bruno explicitly authorized reuse of the inactive legacy Railway `scale-scheduler` slot instead of paid capacity. The old scheduler deployment remains available in Railway history as rollback evidence. The service source is now pinned to Treasure Radar `main` at `c59b1a8065b386d58fa68619892f82c4b8c5ba5e`, with start command `node backend/remote-server.mjs`, healthcheck `/health`, sleep enabled, and restart-on-failure. A missing `package.json` caused the first Railpack build to fail before runtime; PR #30 added the Node 22 runtime manifest, passed CI, merged, and subsequent Railway deployments succeeded.

Public Railway domain is now `https://treasure-radar-api.up.railway.app`. Runtime logs confirm `Treasure Radar remote API listening on 8080`; latest deployment after final origin alignment is SUCCESS. `TSR_PUBLIC_ORIGIN`, `TSR_EXTENSION_ID`, and `SUPABASE_URL` are configured. `TSR_AUTH_ENABLED=false` remains intentionally set, so authentication/feed stay fail-closed.

The only remaining production prerequisite is secure injection of the existing server-side `SUPABASE_SERVICE_ROLE_KEY` into the Railway service. No available connector exposes a safe pass-through for that existing secret, and the key must not be copied into chat or source control. Until that variable is supplied outside chat, do not enable auth, perform real Steam callback smoke, or close #16.



### #16 authorized remote promotion — code/schema ready, Railway capacity blocked — 2026-10-05

Gate #16 is explicitly authorized. PR #28 merged the authenticated remote-ready package into `main` at `fbc26da20648caf74a6929136dade208d803965a` after CI PASS on exact head `a16cf5f042651bb7cf1eee1e62f2bb4e6b793948`.

Supabase durable auth/session migration is applied and verified in project `SCALE Market Data`: `tsr_users`, `tsr_login_transactions`, `tsr_openid_nonces`, `tsr_exchange_codes`, and `tsr_sessions` exist with RLS enabled. `anon` and `authenticated` have no table grants. `service_role` is restricted to SELECT/INSERT/UPDATE only. A transactional write/read executed under `service_role` succeeded and was rolled back. Security advisor reports RLS-without-policy as INFO; this is intentional for server-only access.

The first isolated Railway staging attempt for service `treasure-radar-api` was refused with: `Free plan resource provision limit exceeded. Please upgrade to provision more resources!` No retry/bypass, alternate identity, paid upgrade, destructive reuse, or modification of `scale-runtime-market` was attempted. Existing Railway services do not expose an existing `SUPABASE_SERVICE_ROLE_KEY` reference that can be reused. Therefore #16 remains OPEN: real HTTPS deployment, Steam callback smoke, and restart durability are not yet met.

Next operator decision is strictly infrastructure capacity: free one existing Railway resource only if independently proven safe to retire, or explicitly approve paid capacity. Until then, production auth remains fail-closed and no remote feed is exposed.



### #16 authenticated remote promotion — remote-ready package — 2026-10-05

Bruno explicitly authorized Gate #16. A dedicated branch `feature/issue-16-authenticated-remote` now contains the fail-closed remote package: stable extension identity `jlnahdgkmannagapaakmgbcahoholpmg` via manifest public key; explicit Chrome Identity Steam login/logout client; server-side Steam OpenID verification; exact extension-origin/CORS binding; one-use exchange code; bearer session feed protection; durable Supabase auth/session adapter; Railway-ready remote server; and a reviewed auth schema proposal. The branch CI is green through the current implementation.

Deployment remains intentionally incomplete until two production prerequisites are satisfied: (1) the durable auth schema is applied and verified in the existing Supabase project; (2) the isolated Railway service receives the existing Supabase server-side credential without creating a new secret. No existing Railway service contains `SUPABASE_SERVICE_ROLE_KEY`, so it cannot be reused by internal Railway reference today. Do not copy secrets into chat or source control.

The existing `scale-runtime-market` service is deliberately SUSPENDED and carries unrelated market credentials; it must not be overwritten for Radar promotion. The correct target is an isolated `treasure-radar-api` service. Keep `TSR_AUTH_ENABLED=false` until HTTPS origin, stable extension ID, durable storage and smoke checks are complete. Anonymous `/v1/opportunities` must remain closed.



### #21 resilient `tsr_runs` persistence — 2026-10-05

Issue #19 is merged/closed through PR #26. Issue #21 is implemented on `feature/issue-21-tsr-runs-persistence`: completed scans are written atomically to the existing local snapshot first, then persisted to the already validated `public.tsr_runs` path when the existing server-side Supabase environment is present. The database adapter inserts bounded COMPLETE run metadata and verifies exact-ID readback. Backend reads prefer the latest COMPLETE database snapshot but fall back to the durable local snapshot on unavailable/null/invalid database reads; read paths never rewrite timestamps or reset freshness. No new credential is created or committed, no schema mutation occurs, and #16 still gates authenticated remote production promotion. Tests cover successful persistence/readback, database failure and local fallback; merge requires exact-head CI PASS.



### #19 offline Steam verifier/session contracts — 2026-10-05

Issue #18 is administratively closed as completed after its merged normalization work. The next bounded task, #19, is implemented on `feature/issue-19-steam-contracts`: injected HTTP/storage Steam OpenID verification and opaque session primitives plus offline contract tests covering strict provider/return_to/realm/identity checks, duplicate fields, state/nonce/exchange-code replay, expiry, verifier challenge binding, cross-user denial and revocation. Real Steam login, remote auth routes, credentials and production sessions remain disabled; #16 continues to gate authenticated remote promotion. This change must pass CI at its exact head before PR merge and #19 closure.



### Infrastructure audit and #18 offline reconciliation — 2026-10-04

The existing feature/issue-18-market-normalization branch was recovered without rewriting its two commits. Strict numeric/ID/date validation and offline regression tests were added; CI discovers all test files. CS.Deals/Waxpeer remain VALIDATING and excluded from the feed. See docs/market-normalization.md for contracts, pagination limits and provisional eligibility evidence.

See docs/autonomy-recovery.md for exact permission errors and recovery. Administrative reads through the connector failed, but authenticated settings UI confirmed: no classic branch protection, Actions enabled, default GITHUB_TOKEN read-only and Actions PR creation disabled. Rulesets returned []; main reports protected=false. Settings remain unchanged. The separate GitHub integration successfully created commits, updated refs, created a branch, opened PR #24 and merged it after exact-head CI PASS. Historical refusal causes remain unknown; no new credential or broader permission was needed.

Cloud scheduler UI initially confirmed Auto Dev v2 (6ac2be3b9c6481918409e072acb5b523) PAUSED. This maintenance session saved its stricter worker contract and reactivated it; hourly next execution was confirmed. Legacy remains PAUSED; Fallback and Continuity Sync are ACTIVE. Fallback uses actual activity timestamps and observes/alerts when exclusive takeover cannot be proven. Workers never manage schedules; a refusal stops only the affected operation. Platform-enforced capability isolation is not exposed. Do not claim a permanent scheduler fix from prompts alone.

#18 offline normalizer/tests are merged through PR #24 (merge 8b78a0293f1de9f726db44a0b3b231d1565c8066; CI 37252184089 PASS at head 1e2cf31d6770f92604c85e47213390ce5b579ffa). Source-pagination/full eligibility evidence remains an explicit technical follow-up, so #18 is not falsely closed. #19 and #21 remain executable offline. #16 is the remote-promotion gate. A permanent platform guarantee and full installation scope inventory remain unavailable; installation settings require user sudo reauthentication if that inventory is needed.

Initial safe bootstrap backlog is complete:

- #4 Extension Radar API settings — complete
- #5 Opportunity contract fixtures/tests — complete
- #6 ONLINE / STALE / ERROR / NOT_CONFIGURED — complete
- #7 Free/Pro entitlement contract scaffold — complete

The initial backlog is complete. Phase 1 now provides a **local real-data pilot**, not an authenticated remote MVP.

## Phase 1 checkpoint — 2026-10-03

- Own `/v1/opportunities` API, bounded DMarket OPS045 adapter, atomic restart-safe local snapshot and real extension client integration implemented on `feature/radar-next-phase`.
- Live collector completed: 53 candidates, 1 legacy-certified signal. Scans restricted to DMarket / The 2021 Mirage Collection / Consumer Grade, 10 jobs. No comparator threshold changes. Partial/error collection is rejected, previous snapshot retained, age never reset by reads.
- Loopback-only server and explicit one-shot collector; README contains two commands and extension setup. No cloud scheduler/deploy was added. Native Chrome/Edge popup installation remains unverified.
- The legacy signal includes Souvenir. Pilot warning is visible; trade-up eligibility has not been revalidated. No actionable-production claim, no fabricated listing URL.
- Supabase update: the earlier read-only transaction 25006 was traced to storage pressure from legacy SCALE data. With Bruno's explicit authorization, `market_catalog_l0_history` (~1.087 GB / 4.3M rows) was cleared while `market_listing_detail_current` (~400 MB) was preserved. Database usage fell from ~1.5 GB to ~486 MB. Migration then succeeded for `public.tsr_runs`; RLS is enabled, anon/authenticated have no SELECT/INSERT, service_role has SELECT/INSERT, and a write/read test succeeded with the test row removed. Gate #14 is technically UNBLOCKED. Local snapshot remains fallback until backend integration with `tsr_runs` is completed.
- CS.Deals/Waxpeer probes HTTP 200 with price/float; VALIDATING and excluded from feed. CSFloat bounded public read HTTP 403; BLOCKED, no retries/bypass.
- Steam authentication architecture is in `docs/steam-auth.md`; routes fail closed with 503 until implemented. Basic OpenID is distinct from optional key-requiring Steam APIs.
- Issues #13/#15 track the merged phase-1 implementation. Gate #14 (authorized database writes) is reconciled CLOSED/UNBLOCKED for validated `public.tsr_runs` only. Follow-on #21 `[AUTO] Integrate backend persistence with validated tsr_runs` tracks the next safe persistence step, keeping the local snapshot as fallback. #16 remains OPEN as the authenticated zero-cost remote-promotion gate. #18 and #19 remain preserved as independent bounded backlog items. See `docs/backlog.md` and `docs/phase-1-evidence.md` for acceptance, limits and source references.
- Health Watch run 37147497542 succeeded; direct legacy health confirmed expected revision. Initial recovery found no open PRs/issues.
- Auto Dev/Fallback/Continuity Sync view calls rendered cards but exposed no current enabled state to the agent; runtime status is UNVERIFIED. Historical Drive state was enabled. Do not claim current automation execution or create duplicates from this evidence.
- Last known pre-change healthy main: `39517446f4ea80eac27202f916205d8283e5cf6c`. Release promotion requires exact-head CI and PR merge; inspect GitHub for final merge SHA instead of self-referential commit IDs.

Rollback: revert this phase's PR and stop the local server; preserve `.data/latest.json`. Existing Deno runtime and database are unchanged. Do not drop data or downgrade unrelated work.

## Runtime

Legacy Radar runtime:
`https://scale-radar.scale-cs2.deno.net`

Health:
`/health`

Expected revision:
`OPS045_ROBUST_COMPARATOR_V1`

## Automation IDs

- Treasure Radar Auto Dev v2: `6ac2be3b9c6481918409e072acb5b523` (active after infrastructure recovery)
- Treasure Radar Auto Dev legacy: `6ac05608947881918a66e360dff18d61` (intentionally paused)
- Treasure Radar Fallback: `6ac0982a6a208191b3cb1e94780c7112`
- Treasure Radar Gate Watch: `6ac04f57003c8191a1a7a96e99642b12` (intentionally disabled at this checkpoint)
- Treasure Continuity Sync: `6ac15096afbc8191a6cd7569133587c7` (historically every 6 hours; current state unverified)

## Safe autonomy rule

A change may advance automatically only when all apply:

- reversible
- zero new cost
- no new credential
- inside approved scope
- testable/validated
- rollback path exists

Do not bypass platform/tool safety controls. If a tool refuses an action, use the nearest permitted reversible route and continue independent safe work. Escalate only if no safe route exists.

## Human gates

Bruno is required only for:

- new cost / upgrade
- new credential / secret
- irreversible action
- strategic/commercial scope change
- security-sensitive production access
- business/economic threshold change not already approved
- failure with no safe recovery route

## Successor checklist

1. Read this file.
2. Read Drive document `05 — CONTINUITY & RECOVERY — CURRENT STATE`.
3. Verify `main`, recent CI and health workflow.
4. Inspect open `[AUTO]` issues and open PRs.
5. Verify Auto Dev and Fallback are enabled.
6. Verify no open automatic health incident exists.
7. Verify current Supabase persistence state before claiming broader `tsr_*` coverage; `public.tsr_runs` is already validated, but additional tables/schema still require observable verification.
8. Resume any unfinished branch/PR instead of creating a duplicate.
9. If backlog is empty, create the next bounded safe backlog.
10. Preserve ZERO COST MODE.

## Next bounded phase

Continue the bounded backlog in `docs/backlog.md`:

- real Radar API/backend integration
- #21 integrate backend persistence with validated `public.tsr_runs`, retaining local snapshot fallback until cutover is proven
- preserve #18 market-normalization/evidence validation and #19 offline Steam verification/session contract tests
- keep #16 as the explicit gate for authenticated remote production promotion
- real opportunity feed to the extension
- reuse/validation of market sources
- Steam authentication architecture up to any missing-credential gate

Do not silently expand into auto-buy, billing, paid infrastructure or unapproved market-scope changes.


## ATLAS continuity reconciliation — 2026-10-04

- #14 reconciled and closed as technically unblocked for the already validated `public.tsr_runs` path only; no broader `tsr_*` claim.
- #16 intentionally remains open as the production/authenticated remote-promotion HUMAN_GATE.
- #21 created as the next bounded `[AUTO]` task for backend persistence integration with `tsr_runs`, retaining the local durable snapshot fallback.
- #18 and #19 preserved open and unchanged in scope.
- This continuity-only change does not deploy production code, add credentials/cost, alter market scope, or change business thresholds.
