\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  r jsonb;
  snap jsonb;
  before_count integer;
  delay_seconds numeric;
begin
  -- CI fixture; whole suite rolls back. Do not run this data-reset suite in production.
  delete from public.tsr_runs;
  update public.tsr_refresh_control set owner=null,lease_until='-infinity',next_attempt_at='-infinity',
    failures=0,window_attempts=0,window_started_at=clock_timestamp(),halted=false;
  r := public.tsr_refresh_claim(a);
  assert r->>'status'='ACQUIRED', 'first claim';
  assert public.tsr_refresh_claim(b)->>'status'='COOLDOWN', 'second owner denied';
  assert public.tsr_refresh_finish(b)->>'status'='LEASE_LOST', 'foreign release denied';
  assert (select owner=a from public.tsr_refresh_control), 'foreign release preserves owner';
  r := public.tsr_refresh_finish(a, null, 7200, false);
  assert r->>'status'='BACKOFF' and (r->>'wait_ms')::bigint>=7200000, 'Retry-After respected';
  assert public.tsr_refresh_claim(b)->>'status'='COOLDOWN', 'restart respects cooldown';
  update public.tsr_refresh_control set next_attempt_at='-infinity';
  assert public.tsr_refresh_claim(b)->>'status'='ACQUIRED';
  r := public.tsr_refresh_finish(b);
  assert (r->>'wait_ms')::integer=600000, 'exponential failure backoff';
  update public.tsr_refresh_control set next_attempt_at='-infinity',lease_until='-infinity';
  assert public.tsr_refresh_claim(a)->>'status'='ACQUIRED';
  update public.tsr_refresh_control set lease_until=clock_timestamp()-interval '1 second';
  assert public.tsr_refresh_finish(a)->>'status'='LEASE_LOST', 'expired owner cannot publish';
  assert public.tsr_refresh_claim(b)->>'status'='COOLDOWN', 'crashed worker minimum gap';
  update public.tsr_refresh_control set next_attempt_at='-infinity';
  assert public.tsr_refresh_claim(b)->>'status'='ACQUIRED', 'expired lease recoverable';
  assert public.tsr_refresh_finish(a)->>'status'='LEASE_LOST', 'old owner fenced after takeover';
  snap := jsonb_build_object('status','OK','generated_at',clock_timestamp(),
    'comparator_version','OPS045_ROBUST_COMPARATOR_V1','items','[]'::jsonb,
    'scope',jsonb_build_object('source','DMarket','collection','The 2021 Mirage Collection','rarity','Consumer Grade'));
  r := public.tsr_refresh_finish(b,snap);
  assert r->>'status'='COMPLETE', 'publish completed';
  assert (select count(*)=1 from public.tsr_runs where id=(r->>'run_id')::uuid and snapshot=snap), 'exact durable snapshot';
  assert (select failures=0 and owner is null from public.tsr_refresh_control), 'reset only after success';
  assert public.tsr_refresh_finish(b,snap)->>'status'='LEASE_LOST', 'duplicate publication fenced';
  update public.tsr_refresh_control set next_attempt_at='-infinity';
  assert public.tsr_refresh_claim(a)->>'status'='FRESH', 'database TTL independent of process';
  assert (select snapshot=snap from public.tsr_runs limit 1), 'fresh read never changes capture';
  delete from public.tsr_runs;
  update public.tsr_refresh_control set window_attempts=15;
  assert public.tsr_refresh_claim(a)->>'status'='BUDGET', 'hourly cap';
  update public.tsr_refresh_control set window_started_at=clock_timestamp()-interval '2 hours';
  assert public.tsr_refresh_claim(a)->>'status'='ACQUIRED', 'window expires';
  assert (select window_attempts=1 from public.tsr_refresh_control), 'new window counted';
  perform public.tsr_refresh_finish(a,null,0,true);
  update public.tsr_refresh_control set next_attempt_at='-infinity';
  assert public.tsr_refresh_claim(b)->>'status'='HALTED', '403/manual gate survives restart';
  update public.tsr_refresh_control set halted=false;
  assert public.tsr_refresh_claim(a)->>'status'='ACQUIRED';
  begin
    perform public.tsr_refresh_finish(a,'{}'::jsonb);
    raise exception 'invalid snapshot accepted';
  exception when others then
    if sqlerrm <> 'INVALID_REFRESH_SNAPSHOT' then raise; end if;
  end;
  assert (select count(*)=0 from public.tsr_runs), 'invalid publication atomic';
  -- Retention bounded even after recovery/import; latest successful snapshot survives.
  insert into public.tsr_runs(id,started_at,finished_at,source,status,comparator_version,snapshot)
    select gen_random_uuid(),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',
      'DMarket','COMPLETE','OPS045_ROBUST_COMPARATOR_V1',
      snap || jsonb_build_object('generated_at',clock_timestamp()-interval '1 day') from generate_series(1,30);
  snap := snap || jsonb_build_object('generated_at',clock_timestamp());
  r := public.tsr_refresh_finish(a,snap);
  assert r->>'status'='COMPLETE';
  assert (select count(*)=24 from public.tsr_runs), 'retention cap';
  assert (select count(*)=1 from public.tsr_runs where id=(r->>'run_id')::uuid), 'latest retained';
end;
$$;
reset role;
do $$
begin
  assert not has_function_privilege('anon','public.tsr_refresh_claim(uuid)','execute');
  assert not has_function_privilege('authenticated','public.tsr_refresh_finish(uuid,jsonb,integer,boolean)','execute');
  assert not has_table_privilege('anon','public.tsr_refresh_control','select');
  assert not has_table_privilege('authenticated','public.tsr_refresh_control','update');
  assert (select relrowsecurity from pg_class where oid='public.tsr_refresh_control'::regclass);
  assert not (select prosecdef from pg_proc where oid='public.tsr_refresh_claim(uuid)'::regprocedure);
  assert not (select prosecdef from pg_proc where oid='public.tsr_refresh_finish(uuid,jsonb,integer,boolean)'::regprocedure);
end;
$$;
rollback;
