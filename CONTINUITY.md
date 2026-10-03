# Treasure Skins Radar — Continuity & Recovery

This file is the repository-side cold-start entry point. Do not rely on a previous chat's memory.

## Recovery command for Bruno

Open a new chat in the **Corporação** project and send:

> Retome o Treasure Skins Radar pelo documento `05 — CONTINUITY & RECOVERY — CURRENT STATE` no Drive e pelo `CONTINUITY.md` do repositório `castrobruno77/treasure-radar-autonomy`. Reconstrua o estado pelas fontes de verdade, verifique automações/health/backlog e continue do próximo passo seguro. Não dependa da memória do chat anterior.

## Sources of truth

- **Drive:** human canonical documentation.
- **GitHub:** code, versions, CI, PRs and rollback.
- **Supabase:** intended operational state; verify write capability before assuming `tsr_*` persistence exists.
- **ChatGPT Project:** context and specialists; not authoritative state.

Drive folder: `TREASURE SKINS RADAR`  
Drive folder ID: `1krO8gn-L8l83Q3xvbGoKjCxm7iF-nrSb`  
Continuity document ID: `1v2Z5r4Kb_CY4BVjcuq8vYg18lmVDBcCEX4hAXjw1Zak`

## Current checkpoint

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
- Supabase `tsr_*` absent by readback. Migration refused once with read-only transaction 25006; proposal retained in `docs/tsr-schema-proposal.sql`. No bypass. Local storage is NOT operational Supabase.
- CS.Deals/Waxpeer probes HTTP 200 with price/float; VALIDATING and excluded from feed. CSFloat bounded public read HTTP 403; BLOCKED, no retries/bypass.
- Steam authentication architecture is in `docs/steam-auth.md`; routes fail closed with 503 until implemented. Basic OpenID is distinct from optional key-requiring Steam APIs.
- Issues #13/#15 track this implementation; #14 is the database-write gate; #16 is authenticated zero-cost deployment. See `docs/backlog.md` and `docs/phase-1-evidence.md` for acceptance, limits and source references.
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

- Treasure Radar Auto Dev: `6ac05608947881918a66e360dff18d61`
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
7. Verify Supabase write capability before claiming `tsr_*` persistence exists.
8. Resume any unfinished branch/PR instead of creating a duplicate.
9. If backlog is empty, create the next bounded safe backlog.
10. Preserve ZERO COST MODE.

## Next bounded phase

Continue the bounded backlog in `docs/backlog.md`:

- real Radar API/backend integration
- Treasure Skins Radar operational persistence under its own namespace
- real opportunity feed to the extension
- reuse/validation of market sources
- Steam authentication architecture up to any missing-credential gate

Do not silently expand into auto-buy, billing, paid infrastructure or unapproved market-scope changes.
