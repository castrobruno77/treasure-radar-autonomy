-- Canonical schema, applied through Supabase apply_migration after CI PASS.
-- All times and budgets are authoritative database time, never worker time.
create table public.tsr_refresh_control (
  singleton boolean primary key default true check (singleton),
  owner uuid,
  lease_until timestamptz not null default '-infinity',
  next_attempt_at timestamptz not null default '-infinity',
  started_at timestamptz,
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  window_attempts integer not null default 0 check (window_attempts >= 0),
  total_attempts bigint not null default 0,
  total_completed bigint not null default 0,
  halted boolean not null default false,
  last_result text
);
alter table public.tsr_refresh_control enable row level security;
revoke all on public.tsr_refresh_control from public, anon, authenticated;
grant select, update on public.tsr_refresh_control to service_role;
insert into public.tsr_refresh_control(singleton) values (true);
-- Retain at most 24 COMPLETE snapshots (~96 minutes); no auth data is touched.
grant delete on public.tsr_runs to service_role;

create function public.tsr_refresh_claim(p_owner uuid) returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '2s'
as $$
declare
  c public.tsr_refresh_control%rowtype;
  t timestamptz := clock_timestamp();
  latest timestamptz;
  due timestamptz;
begin
  if p_owner is null then raise exception 'OWNER_REQUIRED'; end if;
  select * into strict c from public.tsr_refresh_control where singleton for update;
  t := clock_timestamp();
  if c.halted then return jsonb_build_object('status','HALTED','wait_ms',300000); end if;
  due := greatest(c.next_attempt_at, c.lease_until);
  if due > t then
    return jsonb_build_object('status','COOLDOWN','wait_ms',ceil(extract(epoch from due-t)*1000));
  end if;
  select (snapshot->>'generated_at')::timestamptz into latest
    from public.tsr_runs where status='COMPLETE' order by finished_at desc limit 1;
  if latest > t + interval '5 seconds' then raise exception 'INVALID_SNAPSHOT_TIME'; end if;
  if latest is not null and latest + interval '240 seconds' > t then
    return jsonb_build_object('status','FRESH','wait_ms',ceil(extract(epoch from latest+interval '240 seconds'-t)*1000));
  end if;
  if c.window_started_at + interval '1 hour' <= t then
    c.window_started_at := t;
    c.window_attempts := 0;
  end if;
  if c.window_attempts >= 15 then
    return jsonb_build_object('status','BUDGET','wait_ms',ceil(extract(epoch from c.window_started_at+interval '1 hour'-t)*1000));
  end if;
  update public.tsr_refresh_control set owner=p_owner, lease_until=t+interval '180 seconds',
    started_at=t, next_attempt_at=t+interval '240 seconds',
    window_started_at=c.window_started_at, window_attempts=c.window_attempts+1,
    total_attempts=total_attempts+1, last_result='RUNNING' where singleton;
  return jsonb_build_object('status','ACQUIRED','wait_ms',240000);
end;
$$;

create function public.tsr_refresh_finish(p_owner uuid, p_snapshot jsonb default null,
  p_retry_seconds integer default 0, p_blocked boolean default false) returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '2s'
as $$
declare
  c public.tsr_refresh_control%rowtype;
  t timestamptz;
  captured timestamptz;
  previous timestamptz;
  run_id uuid;
  delay_seconds integer;
begin
  select * into strict c from public.tsr_refresh_control where singleton for update;
  t := clock_timestamp();
  if p_owner is null or c.owner is distinct from p_owner or c.lease_until <= t then
    return jsonb_build_object('status','LEASE_LOST','wait_ms',300000);
  end if;
  if p_snapshot is null then
    delay_seconds := greatest(least(3600,300 * (2 ^ least(c.failures, 4))::integer),
      least(greatest(coalesce(p_retry_seconds,0),0),2147483647));
    update public.tsr_refresh_control set owner=null, lease_until=t,
      failures=least(failures+1,100), next_attempt_at=t+make_interval(secs=>delay_seconds),
      halted=coalesce(p_blocked,false), last_result=case when p_blocked then 'BLOCKED' else 'FAILED' end
      where singleton;
    return jsonb_build_object('status',case when p_blocked then 'BLOCKED' else 'BACKOFF' end,
      'wait_ms',delay_seconds::bigint*1000);
  end if;
  captured := (p_snapshot->>'generated_at')::timestamptz;
  if captured is null or captured < c.started_at-interval '5 seconds' or captured > t+interval '5 seconds'
    or p_snapshot->>'status' is distinct from 'OK'
    or p_snapshot->>'comparator_version' is distinct from 'OPS045_ROBUST_COMPARATOR_V1'
    or p_snapshot->'scope'->>'source' is distinct from 'DMarket'
    or p_snapshot->'scope'->>'collection' is distinct from 'The 2021 Mirage Collection'
    or p_snapshot->'scope'->>'rarity' is distinct from 'Consumer Grade'
    or jsonb_typeof(p_snapshot->'items') is distinct from 'array'
    or octet_length(p_snapshot::text) > 131072 then
    raise exception 'INVALID_REFRESH_SNAPSHOT';
  end if;
  select (snapshot->>'generated_at')::timestamptz into previous from public.tsr_runs
    where status='COMPLETE' order by finished_at desc limit 1;
  if previous is not null and previous >= captured then raise exception 'NON_ADVANCING_SNAPSHOT'; end if;
  -- Fencing, persistence and release are one transaction. No network call holds this lock.
  run_id := gen_random_uuid();
  insert into public.tsr_runs(id,started_at,finished_at,source,status,comparator_version,snapshot)
    values(run_id,c.started_at,t,'DMarket','COMPLETE','OPS045_ROBUST_COMPARATOR_V1',p_snapshot);
  delete from public.tsr_runs where status='COMPLETE' and id in (
    select id from public.tsr_runs where status='COMPLETE' order by finished_at desc, id desc offset 24
  );
  update public.tsr_refresh_control set owner=null,lease_until=t,failures=0,
    next_attempt_at=greatest(next_attempt_at,captured+interval '240 seconds'),
    total_completed=total_completed+1,last_result='COMPLETE' where singleton;
  return jsonb_build_object('status','COMPLETE','run_id',run_id,'generated_at',captured,'wait_ms',240000);
end;
$$;
revoke all on function public.tsr_refresh_claim(uuid) from public,anon,authenticated;
revoke all on function public.tsr_refresh_finish(uuid,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.tsr_refresh_claim(uuid) to service_role;
grant execute on function public.tsr_refresh_finish(uuid,jsonb,integer,boolean) to service_role;
