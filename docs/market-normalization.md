# Offline market contracts (#18)

These normalizers consume a sanitized internal envelope, not an unmodified live API response. Fixtures are synthetic. Neither source is connected to the production feed; both remain VALIDATING.

The later [#57 Waxpeer read-only adapter](waxpeer-readonly.md) handles the real
public CSV/bid schemas separately, with credential-gated exact-float preparation.
The historical `normalizeWaxpeer` envelope below is not an authorized float feed
and must not be used to bypass the #57 source/provenance gates.

| Contract | CS.Deals | Waxpeer |
| --- | --- | --- |
| Monetary unit | integer USD cents, /100 | integer USD mills, /1000 |
| Stable listing ID | id | item_id |
| Float | cs_paint_wear, explicit number/decimal string in [0,1] | float, same rules |
| Capture evidence | explicit UTC captured_at supplied by collector | explicit Unix seconds timestamp supplied by collector |

Reject missing/null/blank/boolean/object numeric fields, unsafe integer money/IDs, fractional money, malformed rows, duplicate IDs and invalid dates. Capture time is never inferred from a read or current wall clock. These functions do not establish age eligibility or economic certification. Production freshness limits remain unchanged.

Official references inspected during the infrastructure audit:

- https://cs.deals/docs documents integer cents, integer listing IDs and ISO timestamps. Its current authenticated API differs from the legacy sanitized probe: an adapter must map the actual version and fields before promotion. No key was created.
- https://docs.waxpeer.com/api/sell-items/get-my-inventory and https://docs.waxpeer.com/changelog document integer USD x1000. This supports currency scale, not complete equivalence with a live search response.
- CS.Deals listing documentation describes cursor pagination using next_cursor; do not combine partial pages into a complete scan. Any future collector must bound requests, preserve per-page capture evidence, deduplicate across all pages and reject incomplete/error batches. Waxpeer live pagination and capture semantics remain unverified. No pagination/network collector is introduced here.

Eligibility investigation: the indexed official Steam support page https://help.steampowered.com/en/faqs/view/0151-608B-BCAA-D7D5 currently describes normal/StatTrak restrictions and says Souvenir inputs may yield non-Souvenir output. Direct retrieval returned no readable article, so this is provisional indexed evidence, not conclusive validation of the legacy comparator pool. Verify current in-game eligibility and authoritative full text before remote promotion (#16). No comparator or threshold change follows from this investigation.

Acceptance here is offline normalization with explicit limitations. It does not mark CS.Deals/Waxpeer live feeds validated, unblock CSFloat, or certify trade-up economics.
