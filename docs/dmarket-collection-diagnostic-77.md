# #77 COLLECTION component diagnostic

Baseline: merged #80, main `6a060582eadaa0700aa7ad07188794f79de18f77`.
The last authorized downstream sample had 10/10 COLLECTION rejections. This
separate entry point diagnoses that mismatch; it does not correct or activate it.

Entry point (NOT executed live by this change):
`node scripts/check-dmarket-collection.mjs`.

Only Mirage 2021 Consumer NORMAL / MAC-10 | Sienna Damask and Industrial NORMAL /
P90 | Verdant Growth. Exactly one title-only GET per cell when successful, maximum
two total, using the existing /marketplace-api/v2/offers route and gameId/title/limit
parameters. No new filters, retry, pagination, StatTrak admission or Souvenir test.
Five rows maximum per response; oversized arrays fail closed without processing.
1 MiB per response; 30 seconds total; maximum 10 seconds per fetch/body via abort
signal; no new request at/after 20 seconds; 1.1 second inter-request pause. Stops
on the first HTTP, transport, schema, byte or time failure.

Each row emits only booleans, a nullable UTF-16 string length and one category.
Comparison target is cell.source_collection. Precedence:

1. EXACT: strict string equality.
2. CASE: lowercase equality, without trimming.
3. TRIM: trim both strings, preserving case.
4. NORMALIZED: lowercase and remove all characters other than ASCII a-z/0-9
   (the canonical collection uses ASCII). No transliteration or semantic mapping.
5. TOKEN_EQUIVALENT: tokenize lowercase ASCII alphanumeric runs, discard only
   whole tokens `the` and `collection`, sort, compare equal token multisets.
   Retains year, duplicate tokens and any unknown words; not substring matching.
6. DIFFERENT: none of the above, including missing/non-string values. No coercion.

Flags are independent, so multiple can be true; category uses the precedence
above. Each request has counters for all six components and
all_five_rows_same_safe_pattern, true only for exactly five rows with identical
full safe signal objects (including length). This does NOT prove raw equality.
Empty/partial samples never claim agreement of all five rows. No hash is needed.

The unchanged observeP0Identity runs with NORMAL only. Output includes only its
strict-pass count and rejection codes. No raw collection, name, title, quality,
float, listing ID, price, payload, credential or exception text leaves the report.
Even canonical base names are omitted from the output; cell labels identify scope.
HTTP status, byte count and envelope field types are safe metadata. The CLI logs
only the returned report JSON. Synthetic tests are not native evidence.

production_activated=false, planner_exercised=false,
economic_authority='DMARKET_ONLY'. Validator, existing probes, runtime, planner,
economics, scoring, Supabase and Deno are unchanged. #77 and Coverage Beta stay open.

STOP for this unit: local validation + green CI + new PR with exact head for
DIREÇÃO review. No merge, deploy, live probe or Railway accept-deploy. A later live
execution requires separate authorization and reviewed merged code. Any future
execution hook must be removed immediately afterward, restoring preDeployCommand=[]
and checking staged=null, stagedChanges=[], pendingWork=[] and scheduler online.
There is no hook or runtime integration in this PR; rollback before execution is
simply leaving this standalone entry point unused.
