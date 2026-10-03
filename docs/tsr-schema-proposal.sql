-- DRAFT, NOT APPLIED. apply_migration was refused (25006 read-only transaction).
-- Promote via normal migration tooling/CI once an authorized write path exists.
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
-- Acceptance after reviewed application: verify RLS/grants, insert a bounded
-- test run via server role, read exact ID and contents back, prove anon denial.
-- API must select only COMPLETE scans, bound rows and enforce retention.
-- Rollback: stop writes/revert application; preserve table/data (no DROP).
