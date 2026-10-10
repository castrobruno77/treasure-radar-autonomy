# #67 — final bounded CS.Deals hardening

Base main: `6050e5edbe63c570d5bbd69da64782c35c390af8` (PR #65).
Contracts #37/#38/#59 and exact catalog/provenance #63/#64 are unchanged.

## Factual inspect diagnosis

Railway deployment `b1f75b05-634e-43be-bb07-457335229477` SUCCESS emitted
`CSDEALS_INSPECT_STRUCTURE_V2` at `2026-10-10T04:28:54.078Z`.
The ten-page diagnostic found 131 catalog-title rows, all with the modern
`steam://run/730//+csgo_econ_action_preview%20<hex>` family. URI lengths:
115 (1), 119 (19), 121 (110), 135 (1). These are title observations, not yet
fully accepted listings. Original diagnostic redaction also swallowed some
separator digits; raw inspect payloads are deliberately not reproduced here.

The old adapter rejected these before examining their body because it required
`steam://rungame/730/` both at normalization and economic revalidation. Its
`steam://rungame/730/test` fixture was not a valid inspect URI and hid that gap.

Current official CS.Deals listings docs expose `cs_inspect_link` as a string
alongside native item fields, but do not specify its complete URI grammar:
https://cs.deals/docs/reference/market-data/listings
This documentation alone cannot prove that every Steam-scheme string is safe.
Implementation corroboration (not Valve/CS.Deals certification):
https://github.com/Helyux/cs2inspect/tree/6fe57cd824173d33994e57b45321913a4f22c66b
Its native example, XOR-envelope layout and CEconItemPreviewDataBlock field
schema establish the decoded family observed live. Valve protocol wiki could
not be fetched (403); no unobserved URI family is admitted on that basis.

## Narrow correction and limits

The shared guard accepts only:
- Native masked item data under the exact observed `run/730//` URI; bounded
  even-length hex, nonzero XOR byte, bounded protobuf field parsing, matching
  item ID, paintwear IEEE-754 value, paint index and seed from the listing.
- Legacy `rungame/730/76561202255233023/` plus a complete S/M-A-D pointer with
  uint64 bounds and the same asset ID. Legacy acceptance is structural pointer
  validation; it does not call Steam to resolve the asset.

No whitespace/control bytes, suffix, extra command, other app/scheme, URL
double decoding, arbitrary launch path or synthetic zero-mask family passes.
Native trailer bytes are NOT authenticated/checksum-certified: the referenced
implementation explicitly does not establish reliable native masked CRC
semantics. This is an inspect format and item-consistency check, not an
authenticity signature or proof that Steam currently renders the item. No
inspect URI is executed. Unknown URI/protobuf fields outside the bounded schema
fail closed. Existing 500-character limit remains; longer valid decorated
items can be excluded and must not be reported as absent.

## One-shot post-merge probe

`node scripts/check-csdeals-hardening.mjs` performs at most 20 × 500 listing
rows, one returned full averages response and 140 exact-name sales pages of
100 rows. Pacing: 1.1s/listings and 5.1s/sales, existing response/timeout caps;
first failure stops, no retry loop. Wall deadline 1,500s, pre-deploy timeout
1,600s. All 70 identities get an anchor series: highest-count returned average,
otherwise observed accepted listing, otherwise NORMAL wear containing the
catalog float midpoint. Other returned average series fill the remaining cap.
This surveys all identities without claiming all wear/variant histories were
individually paged. Any unsampled average series is disclosed.

Native identity, exact float and acceptance counts are separate. Report fixed
inspect format/byte-count labels only, source hashes/times, accepted examples,
actual collection/rarity/variant groups, sale density and the 70-row matrix.
No keys, inspect payloads or raw account/response bodies are logged.

Density gates and full reference eligibility are reported separately. Later
queries may exceed the existing 180s ask observation cap and remain blocked;
the probe never re-dates an old observation. Averages are sampled first.
Missing average means no evidence returned, not zero liquidity. Recent sales
are not asserted settled, nor float-aware. No economic threshold is changed.

## Delivery / rollback / stop

Local tests and complete CI must PASS before merge; final live findings belong
in #67/#42. Production promotion is not implied by this code or a CI PASS.
The adapter remains isolated from scheduler/feed and SOURCE_VALIDATING.
Configure the one-shot probe only on the existing scheduler with its existing
secret reference; clear preDeployCommand and reset timeout afterward. Verify
no staged changes and a clean final deployment. Do not redeploy a historical
snapshot containing diagnostic commands. Roll back code by reverting this PR;
no database migration or source secret change is involved. Prior canonical
commit is the base above.

STOP: only #67. No P0 activation, 16-cell activation, #60/#61/#41, trading,
WebSocket, monetization, QUICK_EXIT/BID_EXECUTABLE, P1/P2 or next integration.
