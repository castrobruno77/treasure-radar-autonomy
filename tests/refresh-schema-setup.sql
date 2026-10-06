-- CI database only. Never run this role/table bootstrap against production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to service_role;
\i docs/tsr-schema-proposal.sql
\i database/refresh.sql
