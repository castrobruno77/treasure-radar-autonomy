# Controlled recurring freshness — issue #33

The initial snapshot is already validated with a real Steam session. Recurrence is
opt-in with `TSR_REFRESH_ENABLED=true` on the **existing** Radar Railway service.
Steam auth, feed authorization/CORS, market scope and comparator are unchanged.
No new service, cron product, paid plan, credential or auto-buy operation is added.

## Timing and resource bounds

- Database TTL: 240 seconds from actual snapshot capture; requests never rewrite it.
- Global minimum interval: 240 seconds between acquisition attempts, including crashes.
- Single database lease: 180 seconds, longer than the collector's 105-second maximum
  plus bounded persistence. Local single-flight prevents overlapping timer callbacks.
- Maximum 15 attempts per database hour window. Each scan retains its original
  DMarket/Mirage/Consumer Grade scope, 10 jobs and concurrency 2.
- No immediate retries: failures wait 5, 10, 20, 40, then at most 60 minutes.
  HTTP 429 waits at least 15 minutes; a longer Retry-After (seconds or HTTP date)
  is honored. HTTP 401/403 and a mismatched upstream revision halt collection until
  an operator investigates and explicitly clears the control row's halted state.
- Recurrence waits until the returned due time, with 0–5 seconds positive jitter.
  Database rechecks are at most every 30 seconds and normally every 4–5 minutes;
  no queue of missed cycles is replayed after downtime.
- Keep the newest **24 COMPLETE snapshots** (~96 minutes at normal cadence), with
  a 128 KiB per-snapshot ceiling: at most 3 MiB JSON text before database/index
  overhead. Retention only runs after successful publication and preserves the
  latest valid row. Cumulative attempt/completion counters stay in one control row.
  Existing database occupancy is substantial; no unrelated data cleanup is performed.

The process uses the existing free-plan capacity and keeps Railway sleep enabled.
Timers run only while the process is alive. If the platform suspends the service or
exhausts its free quota, no paid wakeup or quota bypass is attempted; the next normal
startup checks the durable due time. This is bounded best-effort freshness, not an
always-on uptime guarantee. Collection latency, downtime and failures may still
produce STALE (>300 seconds), and that truth is preserved in the API and extension.

## Durable coordination and security

`database/refresh.sql` is the canonical schema applied as one Supabase migration.
The singleton `tsr_refresh_control` uses database time and short `FOR UPDATE`
transactions. Market HTTP calls run outside transactions. Acquire reserves the
next attempt before scanning; crashes cannot reset rate limits. Finish checks the
owner UUID and unexpired lease, inserts into `tsr_runs`, prunes old COMPLETE rows
and releases the lease atomically. Expired or replaced owners cannot publish.
Successful publication is followed by exact-ID readback and capture validation.

RLS remains enabled. `anon`/`authenticated`/PUBLIC have no control-table grants or
RPC execution. Both functions are SECURITY INVOKER with an empty search_path;
only service_role can invoke them. service_role receives DELETE on tsr_runs for
bounded retention, in addition to existing SELECT/INSERT. No auth tables change.
No secrets or raw upstream/storage exceptions are logged.

The refresh loop takes precedence over the historical bootstrap flag. Remote
`collect-once.mjs` also uses the durable coordinator; the local pilot retains its
file lock. When recurrence is enabled, the preparation command delegates to the
same coordinator. Feed requests themselves never launch scans.

## Release and rollback

1. Issue → branch from main → local tests → CI (Node and real Postgres 17.6).
   CI checks SQL TTL/backoff/budget, stale-owner fencing, retention, RLS/grants and
   an eight-session race with exactly one acquisition winner.
2. Require PASS on exact PR head before merge. Reference #33 without auto-closing it.
3. Apply the reviewed schema to the existing SCALE Market Data database using
   Supabase migration tooling, then verify grants/RLS and a rolled-back claim race.
   Never run `tests/refresh-schema-setup.sql` or the data-reset SQL suite in production.
4. Stage only the approved merged SHA, `TSR_REFRESH_ENABLED=true` and
   `TSR_BOOTSTRAP_FEED=false` on existing Railway service
   `8c11c1d8-0620-4ce1-a221-2f78af3cf577`, environment
   `04de426d-1eb6-4998-b9c6-0f1488e43a01`. Preserve other config/secrets/services.
5. Deploy and observe at least two COMPLETE refresh events across TTL, distinct
   advancing captures in tsr_runs, released lease, incrementing budget/counters,
   and public health/auth guards (200/401/403). Verify the actual stored snapshots
   satisfy the feed contract. Only then close #33 with evidence.

Rollback: disable TSR_REFRESH_ENABLED, keep TSR_BOOTSTRAP_FEED=false, and restore
the previous approved source SHA. Allow any current lease to expire. Retain the
control table, run data and auth sessions. No DROP or reset. A later resume honors
the existing cooldown, failures and halted state. Do not clear rate limits merely
to force another scan. Use read-only control/run queries for diagnosis.
