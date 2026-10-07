-- Operational telemetry foundation for issue #40.
-- Lightweight 30-day records only; heavy snapshot retention remains governed by #33.

create table public.tsr_run_telemetry (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  source text not null,
  collection text,
  rarity text,
  variant_scope text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms bigint not null check (duration_ms >= 0),
  jobs_planned integer check (jobs_planned is null or jobs_planned >= 0),
  jobs_completed integer check (jobs_completed is null or jobs_completed >= 0),
  listing_count_seen integer check (listing_count_seen is null or listing_count_seen >= 0),
  comparable_count integer check (comparable_count is null or comparable_count >= 0),
  candidate_count integer check (candidate_count is null or candidate_count >= 0),
  certified_count integer check (certified_count is null or certified_count >= 0),
  status text not null check (status in ('COMPLETE','ERROR')),
  error_code text,
  retry_count integer not null default 0 check (retry_count >= 0),
  rate_limit_hit boolean not null default false,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 0),
  snapshot_age_at_start integer check (snapshot_age_at_start is null or snapshot_age_at_start >= 0),
  collector_version text,
  comparator_version text,
  created_at timestamptz not null default clock_timestamp(),
  check (finished_at >= started_at)
);

alter table public.tsr_run_telemetry enable row level security;
revoke all on public.tsr_run_telemetry from public, anon, authenticated;
grant select, insert, delete on public.tsr_run_telemetry to service_role;

create index tsr_run_telemetry_started_idx on public.tsr_run_telemetry(started_at desc);
create index tsr_run_telemetry_source_collection_idx
  on public.tsr_run_telemetry(source, collection, rarity, started_at desc);

create or replace function public.tsr_record_run_telemetry(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '2s'
as $$
declare
  inserted_id uuid;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'TELEMETRY_EVENT_REQUIRED';
  end if;

  insert into public.tsr_run_telemetry(
    run_id, source, collection, rarity, variant_scope,
    started_at, finished_at, duration_ms,
    jobs_planned, jobs_completed, listing_count_seen, comparable_count, candidate_count, certified_count,
    status, error_code, retry_count, rate_limit_hit, retry_after_seconds,
    snapshot_age_at_start, collector_version, comparator_version
  ) values (
    nullif(p_event->>'run_id','')::uuid,
    p_event->>'source',
    nullif(p_event->>'collection',''),
    nullif(p_event->>'rarity',''),
    nullif(p_event->>'variant_scope',''),
    (p_event->>'started_at')::timestamptz,
    (p_event->>'finished_at')::timestamptz,
    (p_event->>'duration_ms')::bigint,
    nullif(p_event->>'jobs_planned','')::integer,
    nullif(p_event->>'jobs_completed','')::integer,
    nullif(p_event->>'listing_count_seen','')::integer,
    nullif(p_event->>'comparable_count','')::integer,
    nullif(p_event->>'candidate_count','')::integer,
    nullif(p_event->>'certified_count','')::integer,
    p_event->>'status',
    nullif(p_event->>'error_code',''),
    coalesce(nullif(p_event->>'retry_count','')::integer,0),
    coalesce((p_event->>'rate_limit_hit')::boolean,false),
    nullif(p_event->>'retry_after_seconds','')::integer,
    nullif(p_event->>'snapshot_age_at_start','')::integer,
    nullif(p_event->>'collector_version',''),
    nullif(p_event->>'comparator_version','')
  ) returning id into inserted_id;

  delete from public.tsr_run_telemetry
    where started_at < clock_timestamp() - interval '30 days';

  return jsonb_build_object('status','RECORDED','id',inserted_id);
end;
$$;

revoke all on function public.tsr_record_run_telemetry(jsonb) from public, anon, authenticated;
grant execute on function public.tsr_record_run_telemetry(jsonb) to service_role;
