-- Issue #16 durable auth/session schema. Apply only after reviewed CI.
create table if not exists public.tsr_users (
  id uuid primary key default gen_random_uuid(),
  steam_id text not null unique check (steam_id ~ '^[0-9]{17}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.tsr_login_transactions (
  state_hash text primary key,
  return_to text not null,
  realm text not null,
  client_return_to text not null,
  verifier_challenge text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  check (expires_at > created_at)
);

create table if not exists public.tsr_openid_nonces (
  nonce_hash text primary key,
  consumed_at timestamptz not null
);

create table if not exists public.tsr_exchange_codes (
  code_hash text primary key,
  steam_id text not null references public.tsr_users(steam_id) on update cascade on delete restrict,
  verifier_challenge text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  check (expires_at > created_at)
);

create table if not exists public.tsr_sessions (
  token_hash text primary key,
  steam_id text not null references public.tsr_users(steam_id) on update cascade on delete restrict,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  check (expires_at > issued_at)
);

alter table public.tsr_users enable row level security;
alter table public.tsr_login_transactions enable row level security;
alter table public.tsr_openid_nonces enable row level security;
alter table public.tsr_exchange_codes enable row level security;
alter table public.tsr_sessions enable row level security;

revoke all on public.tsr_users, public.tsr_login_transactions, public.tsr_openid_nonces, public.tsr_exchange_codes, public.tsr_sessions from public, anon, authenticated;
grant select, insert, update on public.tsr_users, public.tsr_login_transactions, public.tsr_openid_nonces, public.tsr_exchange_codes, public.tsr_sessions to service_role;

create index if not exists tsr_login_expires_idx on public.tsr_login_transactions (expires_at);
create index if not exists tsr_code_expires_idx on public.tsr_exchange_codes (expires_at);
create index if not exists tsr_sessions_steam_idx on public.tsr_sessions (steam_id);
create index if not exists tsr_sessions_expires_idx on public.tsr_sessions (expires_at);
