-- Authentication bridge only. Stock operations and ledger remain unchanged.
create schema if not exists inventory_auth;
revoke all on schema inventory_auth from public, anon, authenticated;
create table inventory_auth.mcp_client (
  singleton boolean primary key default true check (singleton),
  client_id text not null check (length(client_id) between 1 and 200),
  resource text not null check (resource ~ '^https?://[^/?#]+/api/mcp$')
);
alter table inventory_auth.mcp_client enable row level security;
revoke all on inventory_auth.mcp_client from public, anon, authenticated, service_role;

create function inventory_auth.custom_access_token(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare binding inventory_auth.mcp_client; claims jsonb := event->'claims';
begin
  select * into binding from inventory_auth.mcp_client where singleton;
  -- Match claims.client_id on authorization AND refresh, never authentication_method.
  if binding.client_id is not null and claims->>'client_id' = binding.client_id then
    claims := jsonb_set(jsonb_set(claims, '{aud}', to_jsonb(binding.resource)), '{role}', '"anon"'::jsonb);
    claims := jsonb_set(claims, '{exp}', to_jsonb(least((claims->>'exp')::bigint, (claims->>'iat')::bigint + 300)));
  end if;
  return jsonb_build_object('claims', claims);
end $$;
revoke all on function inventory_auth.custom_access_token(jsonb) from public, anon, authenticated, service_role;
grant usage on schema inventory_auth to supabase_auth_admin;
grant execute on function inventory_auth.custom_access_token(jsonb) to supabase_auth_admin;

-- No password in SQL. Provision it later through the protected admin channel.
do $$ begin
  if not exists (select from pg_roles where rolname = 'inventory_mcp') then
    create role inventory_mcp login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if exists (select from pg_roles where rolname = 'inventory_mcp' and
    (not rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Unsafe existing inventory_mcp role';
  end if;
  if exists (select from pg_auth_members where member = 'inventory_mcp'::regrole
    and (roleid <> 'authenticated'::regrole or admin_option))
    or exists (select from pg_class where relowner = 'inventory_mcp'::regrole)
    or exists (select from pg_proc where proowner = 'inventory_mcp'::regrole)
    or exists (select from pg_namespace where nspowner = 'inventory_mcp'::regrole)
    or exists (select from pg_database where datdba = 'inventory_mcp'::regrole) then
    raise exception 'Existing inventory_mcp has unexpected memberships or ownership';
  end if;
end $$;
grant authenticated to inventory_mcp with inherit false, set true;

-- PUBLIC grants are inherited even by anon. Explicitly close the operational surface.
revoke all on public.items, public.categories, public.movements, public.source_snapshots,
  public.access_members, public.inventory_operations from public, anon;
revoke all on function public.has_inventory_access(), public.access_state(), public.create_item(jsonb),
  public.mutate_item(uuid,text,jsonb), public.execute_inventory_operation(uuid,jsonb,timestamptz) from public, anon;
