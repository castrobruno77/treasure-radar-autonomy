-- Phase 2 / #48 STEP 1: staged score telemetry fields.
-- No raw market/economic payloads are retained here; 30-day bounded telemetry remains unchanged.

alter table public.tsr_run_telemetry
  add column if not exists quality_scored_count integer
    check (quality_scored_count is null or quality_scored_count >= 0),
  add column if not exists quality_score_avg numeric
    check (quality_score_avg is null or (quality_score_avg >= 0 and quality_score_avg <= 100)),
  add column if not exists economic_scored_count integer
    check (economic_scored_count is null or economic_scored_count >= 0),
  add column if not exists economic_score_avg numeric
    check (economic_score_avg is null or (economic_score_avg >= 0 and economic_score_avg <= 100)),
  add column if not exists economic_blocked_count integer
    check (economic_blocked_count is null or economic_blocked_count >= 0),
  add column if not exists actionable_count integer
    check (actionable_count is null or actionable_count >= 0);

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
    quality_scored_count, quality_score_avg, economic_scored_count, economic_score_avg,
    economic_blocked_count, actionable_count,
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
    nullif(p_event->>'quality_scored_count','')::integer,
    nullif(p_event->>'quality_score_avg','')::numeric,
    nullif(p_event->>'economic_scored_count','')::integer,
    nullif(p_event->>'economic_score_avg','')::numeric,
    nullif(p_event->>'economic_blocked_count','')::integer,
    nullif(p_event->>'actionable_count','')::integer,
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
