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

At this checkpoint, no initial `[AUTO]` backlog remains.

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

Create a safe backlog around:

- real Radar API/backend integration
- Treasure Skins Radar operational persistence under its own namespace
- real opportunity feed to the extension
- reuse/validation of market sources
- Steam authentication architecture up to any missing-credential gate

Do not silently expand into auto-buy, billing, paid infrastructure or unapproved market-scope changes.
