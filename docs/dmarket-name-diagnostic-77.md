# #77 exact-name component diagnostic

After #78, the approved bounded run returned five rows for each of the two
Mirage 2021 titles. All ten failed the compound EXACT_NAME guard. This proves
nonempty responses, but does not distinguish name inequality from title-format
mismatch. No validator correction is justified yet.

New entry point: `node scripts/check-dmarket-name.mjs`.

- Only Mirage 2021 Consumer NORMAL / MAC-10 | Sienna Damask and Industrial
  NORMAL / P90 | Verdant Growth; one title-only GET each, maximum two calls.
- Five rows per call, 1 MiB per response, 30 seconds total, maximum 10 seconds
  per request and 1.1 seconds between calls. No pagination, alternate title,
  filter comparisons, retries, quality query or trading.
- Per-row output is an explicit allowlist: name_equals_base,
  title_starts_with_base, title_matches_known_wear, name_length, title_length,
  exact_name_component (NAME, TITLE, BOTH, NONE). Lengths are JS UTF-16 lengths;
  missing/non-string fields have null lengths and false comparisons.
- title_matches_known_wear means FULL equality with the canonical base plus one
  of the five existing wear suffixes, not a substring/suffix approximation.
  title_starts_with_base is diagnostic only, never an admission criterion.
- Unchanged full validator still runs. Only its rejection counts and strict-pass
  count are reported. No raw name/title/quality/collection/float/listing ID/price
  is logged, even when a row passes. Canonical query labels come from the catalog.
- HTTP status, response byte count/hash and allowlisted envelope types remain
  available. Unknown response fields and private exception messages are omitted.
- Existing probes, identity validator, runtime, economics and score are unchanged.

Tested against both independent failure components, missing fields, deceptive
prefixes, all five wears, StatTrak/Souvenir titles, downstream provenance rejection,
HTTP failures and response/time budgets. These synthetic fixtures are NOT native
DMarket evidence or certification.

Exact-head review, successful CI, merge and the corresponding explicit approval
gate MUST precede any authenticated execution. Run only the merged revision once
on the existing Railway service. Preserve credentials internally; never retrieve
variable values. Restore preDeployCommand=[] and verify staged=null/pendingWork=[]
afterward. Do not rerun either previous probe. Record the safe report in #77.

NAME alone means the canonical title passed but attributes.name differs; TITLE
alone means name passed but title differs; BOTH means both fail; NONE means the
compound guard passed for that sampled row. None of these signals authorizes
relaxing collection/category/float/variant/provenance. A later minimal correction
requires sufficient evidence, its own tests and reviewed release gate. Coverage
Beta stays open until all 16 cells are exercised with factual production telemetry.
