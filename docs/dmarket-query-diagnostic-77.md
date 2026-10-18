# #77 bounded query diagnostic

The 2026-10-18 checkpoint leaves main at
`6500605566c38de8aacebd3d99b7a099b054d60f`. The previous authenticated probe
made 24 successful GETs with no rows. That does not identify a cause or prove
absence of offers. Do not repeat that probe.

## Separate diagnostic

Run `node scripts/check-dmarket-query.mjs` only from an exact-head-reviewed,
CI-green, merged revision in the existing credential-bearing Railway service.
The CLI is not imported by runtime collection. It neither publishes listings nor
writes database state, changes economics, certifies quality enums or activates P0.

Only Mirage 2021 Consumer and Industrial NORMAL are sampled. Each cell uses its
first canonical title, with one alternate canonical title only when the first is
empty. Requests always specify the title and limit=5. No unfiltered market scan,
pagination, guessed quality, trading, new source or arbitrary positive control.

For each cell:

1. GET the first title without collection/category query filters.
2. If empty, GET the second canonical title. If both are empty, stop that cell as
   inconclusive; no claim of absent market offers or a broken filter is justified.
3. If rows fail strict identity validation, report rejection codes and known field
   types; stop that cell. Raw response values are never dumped.
4. Only with a strict identity observation, GET the same title with the original
   collection/category filters. A positive result proves that bounded query works.
5. If filtered results are empty, repeat the title-only control once. Positive
   controls on both sides show a filter-associated difference. Sequential samples
   cannot conclusively isolate filter incompatibility from changing inventory.

The maximum is eight GETs (four per cell); all-empty needs four, contract rejection
two. No retries. 1.1 seconds between calls, five rows and 1 MiB per response,
10-second per-request timeout within a 90-second wall budget. First HTTP failure,
malformed envelope, byte/row cap or transport failure terminates the diagnostic.
HTTP status, response hash, safe envelope/field types and rejection counts separate
observable transport/schema/identity failures from empty samples. Unknown response
properties and exception text are not logged. Accepted observations use the
unchanged `observeP0Identity` gate and remain `OBSERVED_NOT_CERTIFIED`.

Removing a *query* filter for a comparison does not relax acceptance:
collection, category, exact name/title, float, variant and catalog provenance all
remain mandatory. StatTrak/Souvenir rows cannot pass this NORMAL-only diagnostic.
No guessed quality mapping is added. A first title empty with an alternate positive
only establishes a sample difference, not exhaustive absence of the first title.

## Release and cleanup

Local tests and validation, CI, a new PR, then exact-head review/merge precede any
authenticated run. Pin Railway to that merged SHA. Preserve the existing service,
start command, sleeping single replica, credentials and all #33 protections.
Execute the diagnostic once as a temporary pre-deploy command. Capture its single
`DMARKET_QUERY_DIAGNOSTIC_77` report from deployment logs without reading variables.
Then remove the temporary command and verify `preDeployCommand=[]`, `staged=null`,
`pendingWork=[]`, health and anonymous feed denial. Do not redeploy a historical
snapshot containing an old probe hook. Rollback: restore the previous merged
source revision with an empty pre-deploy command; no schema migration is involved.

If evidence is still insufficient, record the factual outcome on #77 and leave
Coverage Beta open. Only sufficient native evidence permits the subsequent
collector → planner → telemetry change. This diagnostic alone cannot prove the
16-cell production requirement or authorize completion of #42.
