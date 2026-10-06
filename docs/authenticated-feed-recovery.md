# Authenticated feed 503 — diagnosis and controlled rollout

## Evidence (2026-10-05, America/Sao_Paulo)

Railway deployment `813a58d5-eb31-4899-a0a6-b292b96a3d5a` logged Steam start 200,
callback 302 and exchange 200, followed by GET `/v1/opportunities` 503.
Read-only database inspection found **zero rows** in `public.tsr_runs`, the expected
seven columns, RLS enabled, service_role SELECT/INSERT allowed and anon SELECT denied.
No session token or server credential was retrieved for this diagnosis.

The configured remote server uses `SupabaseRunsStore` directly. Its empty read returns
null and the feed handler deliberately responds `503 NO_SUCCESSFUL_SCAN` after
authentication. Starting the HTTP server never ran `scripts/collect-once.mjs`.
The local pilot's `.data/latest.json` is ignored by Git and is not the remote feed.
The observed configuration therefore explains the failure without changing Steam auth.
`/health` reports liveness/auth configuration, not successful feed preparation.

## Correction

`TSR_BOOTSTRAP_FEED=true` explicitly enables one preparation attempt **after** the
remote HTTP listener starts. Default startup remains unchanged. Preparation:

1. Requires the existing server-side Supabase configuration and acquires the existing
   container collection lock. This rollout is limited to the current single replica.
2. Reads the durable snapshot. Any valid existing snapshot is retained, even stale;
   database errors/invalid responses abort without contacting the market.
3. Only for an empty database, executes the existing bounded OPS045 collector:
   DMarket, Mirage Collection, Consumer Grade, 10 jobs, concurrency 2; unchanged
   comparator, revision gate, timeouts and rejection of partial/error scans.
4. Requires a COMPLETE Supabase insert and exact-ID validated readback. Local-only
   persistence cannot count as readiness. Database requests have 5-second deadlines.
5. Logs COMPLETE, EXISTING_SNAPSHOT or FAILED without raw exceptions or credentials.
   A failure leaves the API running and the feed fail-closed. There is no in-process
   retry, timer, scheduler, request-triggered scan or automatic stale-data refresh.

An operator may instead run `node scripts/prepare-remote-feed.mjs` once inside the
existing server environment. It exits nonzero on failure. Do not copy secrets to a
developer shell or chat. No new dependencies, service, plan, secret or schema change.

## Controlled redeploy checklist

Target only the reused `scale-scheduler` service
`8c11c1d8-0620-4ce1-a221-2f78af3cf577` in SCALE project
`bb649a46-b2fc-4bf1-926a-8787e6abc727`, production
`04de426d-1eb6-4998-b9c6-0f1488e43a01`.
Keep the one replica, sleep setting, domain, start command and auth variables.
Do not modify `scale-runtime-market` or other SCALE services.

1. Require CI PASS on the exact PR head before merge. Record the resulting merge SHA.
2. Pin the service source to that merged SHA (the diagnosed source is pinned to
   `c59b1a8065b386d58fa68619892f82c4b8c5ba5e`, so merge alone is insufficient).
   Stage `TSR_BOOTSTRAP_FEED=true` on this service only, then perform the controlled
   deployment. Leave SUPABASE_SERVICE_ROLE_KEY and the validated auth values intact.
3. Verify liveness and one preparation log. A bounded scan can take about 105 seconds
   plus database calls; the feed may correctly return 503 while it is in progress.
4. Require a COMPLETE row with a valid snapshot, then use the user's normal extension
   session for a real authenticated HTTP 200 smoke. Do not mint or extract sessions
   for testing. Anonymous access must remain 401; disallowed Origin must remain 403.
5. On later restarts the durable row must be reused without re-collecting or changing
   capture times. After 300 seconds the existing freshness rule produces STALE.
   This fix prepares the first feed; continuous freshness requires a separately
   scoped decision, not an implicit new scheduler.
6. On FAILED, investigate before manually retrying/restarting. If insert succeeded
   but readback failed, inspect the existing row before any new collection. Independent
   cold starts with no row can each attempt once; avoid repeated redeploys on failure.

Rollback: remove/disable TSR_BOOTSTRAP_FEED and pin back to the previous source SHA;
retain all runs and auth/session records. No DROP, reset, credential rotation or
auth downgrade. Production redeploy and live authenticated success are separate
from offline test success and must not be claimed before observed.
