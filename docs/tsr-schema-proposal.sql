-- REFERENCE SCHEMA. public.tsr_runs is already applied and validated in the
-- SCALE Market Data project after Gate #14 recovery. Do not re-apply this file
-- blindly; use it to document the contract consumed by the backend.
-- Snapshot and run metadata in one row avoid incomplete multi-table publication.
create table public.tsr_runs (
  id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  source text not null check (source = 'DMarket'),
  status text not null check (status in ('COMPLETE', 'ERROR')),
  comparator_version text not null,
  snapshot jsonb,
  check (finished_at >= started_at)
);
alter table public.tsr_runs enable row level security;
revoke all on public.tsr_runs from public, anon, authenticated;
grant select, insert on public.tsr_runs to service_role;
create index tsr_runs_finished_idx on public.tsr_runs (finished_at desc);
-- Validated Gate #14 evidence: RLS enabled; anon/authenticated denied; service_role
-- SELECT/INSERT verified; bounded write/read/remove test succeeded. Application
-- integration must still verify exact-ID readback and preserve local fallback.
-- API must select only COMPLETE scans, bound rows and enforce retention.
-- Rollback: stop writes/revert application; preserve table/data (no DROP).
