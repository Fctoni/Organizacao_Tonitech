create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.access_members (
  user_id uuid primary key references auth.users on delete cascade,
  password_changed_at timestamptz
);
alter table public.access_members enable row level security;
revoke all on public.access_members from anon, authenticated;
grant all on public.access_members to service_role;

create function public.has_inventory_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.access_members where user_id = auth.uid()
    and password_changed_at is not null
    and coalesce((auth.jwt()->>'iat')::bigint, 0) >= extract(epoch from password_changed_at));
$$;
create function public.access_state() returns text
language sql stable security definer set search_path = '' as $$
  select case when public.has_inventory_access() then 'ready'
    when exists(select 1 from public.access_members where user_id = auth.uid()) then 'password_required'
    else 'denied' end;
$$;

create table public.categories (name text primary key);
insert into public.categories values ('Electronics'),('Cables'),('Hardware'),('Tools'),('Lighting'),('Computers'),('Household'),('Safety'),('Instruments'),('Groceries'),('Uncategorized');
create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 200),
  shelf integer not null check(shelf >= 1),
  place text not null check(place ~ '^[BW][0-9]{2,9}$' and substring(place from 2)::bigint > 0),
  qty integer not null check(qty >= 0),
  minimum_safe_stock integer not null default 0 check(minimum_safe_stock >= 0),
  category text not null references public.categories(name),
  aliases text[] not null default '{}',
  body text not null default '',
  extra_fields jsonb not null default '{}',
  status text generated always as (case when qty > 0 then 'in_stock' else 'out' end) stored,
  low_stock boolean generated always as (qty < minimum_safe_stock) stored,
  updated_at timestamptz not null default now()
);
create table public.movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items on delete cascade,
  actor uuid references auth.users on delete set null,
  action text not null,
  requested integer,
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);
create table public.source_snapshots (
  filename text primary key,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  original_base64 text not null,
  item_id uuid references public.items,
  projection jsonb,
  imported_at timestamptz not null default now()
);

alter table public.items enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.source_snapshots enable row level security;
create policy read_items on public.items for select to authenticated using (public.has_inventory_access());
create policy read_categories on public.categories for select to authenticated using (public.has_inventory_access());
create policy read_movements on public.movements for select to authenticated using (public.has_inventory_access());
revoke all on public.items, public.categories, public.movements, public.source_snapshots from anon, authenticated;
grant select on public.items, public.categories, public.movements to authenticated;
grant all on public.items, public.categories, public.movements, public.source_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

create function public.create_item(input jsonb) returns public.items
language plpgsql security definer set search_path = '' as $$
declare result public.items;
begin
  if not public.has_inventory_access() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into public.items(name, shelf, place, qty, minimum_safe_stock, category, aliases, body)
  values (input->>'name', (input->>'shelf')::integer, input->>'place', (input->>'qty')::integer,
    coalesce((input->>'minimum_safe_stock')::integer, 0), input->>'category',
    array(select jsonb_array_elements_text(coalesce(input->'aliases','[]'))), coalesce(input->>'body','')) returning * into result;
  insert into public.movements(item_id, actor, action, after_value) values (result.id, auth.uid(), 'create', to_jsonb(result));
  return result;
end $$;

create function public.mutate_item(item_id uuid, action text, input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare previous public.items; result public.items; n integer; warning boolean := false;
begin
  if not public.has_inventory_access() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into previous from public.items where id = item_id for update;
  if not found then raise exception 'Item não encontrado'; end if;
  if action in ('take','add') then
    n := (input->>'n')::integer;
    if n is null or n < 0 then raise exception 'Quantidade deve ser inteiro não negativo'; end if;
    warning := action = 'take' and n > previous.qty;
    update public.items set qty = case when action = 'take' then greatest(0, qty - n) else qty + n end, updated_at = now() where id = item_id returning * into result;
  elsif action = 'relocate' then
    update public.items set shelf = (input->>'shelf')::integer, place = input->>'place', updated_at = now() where id = item_id returning * into result;
  elsif action = 'recategorize' then
    update public.items set category = input->>'category', updated_at = now() where id = item_id returning * into result;
  else raise exception 'Operação inválida'; end if;
  insert into public.movements(item_id, actor, action, requested, before_value, after_value)
    values (item_id, auth.uid(), action, n, to_jsonb(previous), to_jsonb(result));
  return jsonb_build_object('item', to_jsonb(result), 'warning', warning);
end $$;

-- Administrative import: one transaction, lock serializes concurrent imports.
create function public.import_inventory(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry jsonb; p jsonb; known public.source_snapshots; item public.items; inserted integer := 0; skipped integer := 0;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if payload->>'version' <> '1' then raise exception 'Versão inválida'; end if;
  perform pg_advisory_xact_lock(721004);
  for entry in select value from jsonb_array_elements((payload->'items') || (payload->'sources')) loop
    if encode(extensions.digest(decode(entry->>'original_base64','base64'),'sha256'),'hex') is distinct from entry->>'sha256' then raise exception 'Hash inválido'; end if;
    select * into known from public.source_snapshots where filename = entry->>'filename';
    if found then
      if known.sha256 <> entry->>'sha256' then raise exception 'Origem mudou: %', entry->>'filename'; end if;
      skipped := skipped + 1;
      continue;
    end if;
    p := entry->'projection';
    item := null;
    if p is not null then
      insert into public.items(name, shelf, place, qty, minimum_safe_stock, category, aliases, body, extra_fields)
      values (p->>'note', (p->>'shelf')::integer, p->>'place', (p->>'qty')::integer,
        (p->>'minimum_safe_stock')::integer, p->>'category', array(select jsonb_array_elements_text(p->'aliases')),
        entry->>'body', entry->'frontmatter') returning * into item;
      insert into public.movements(item_id, action, after_value) values(item.id, 'import', to_jsonb(item));
      inserted := inserted + 1;
    end if;
    insert into public.source_snapshots(filename, sha256, original_base64, item_id, projection)
      values(entry->>'filename', entry->>'sha256', entry->>'original_base64', item.id, entry);
  end loop;
  return jsonb_build_object('inserted',inserted,'skipped',skipped);
end $$;

revoke all on function public.has_inventory_access(), public.access_state(), public.create_item(jsonb), public.mutate_item(uuid,text,jsonb), public.import_inventory(jsonb) from public, anon, authenticated;
grant execute on function public.has_inventory_access(), public.access_state(), public.create_item(jsonb), public.mutate_item(uuid,text,jsonb) to authenticated;
grant execute on function public.import_inventory(jsonb) to service_role;
