-- Retry ledger: the operation, movement and result commit together, including create.
create table if not exists public.inventory_operations (
  actor uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  movement_id bigint references public.movements on delete set null,
  created_at timestamptz not null default now(),
  primary key (actor, operation_id)
);
alter table public.inventory_operations enable row level security;
revoke all on public.inventory_operations from public, anon, authenticated;
grant all on public.inventory_operations to service_role;

create or replace function public.execute_inventory_operation(operation_id uuid, payload jsonb, expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare known public.inventory_operations; result jsonb; item public.items; movement bigint;
begin
  if not public.has_inventory_access() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if operation_id is null or payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Operação inválida' using errcode = '22023';
  end if;
  -- Hash collisions only serialize unrelated requests; the full PK determines identity.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || operation_id::text, 0));
  select * into known from public.inventory_operations o where o.actor = auth.uid() and o.operation_id = execute_inventory_operation.operation_id;
  if found then
    if known.payload <> payload then raise exception 'ID reutilizado com conteúdo diferente' using errcode = '22023'; end if;
    return known.result;
  end if;
  if expires_at is null or expires_at < clock_timestamp() then
    raise exception 'Proposta expirada sem gravação' using errcode = 'PT410';
  end if;
  if payload->>'action' = 'create' then
    item := public.create_item(payload->'input');
    result := jsonb_build_object('item', to_jsonb(item), 'warning', false);
  elsif payload->>'action' in ('take','add','relocate','recategorize') then
    select * into item from public.items where id = (payload->>'item_id')::uuid for update;
    if not found then raise exception 'Item não encontrado' using errcode = '22023'; end if;
    if (payload->>'expected_updated_at')::timestamptz is distinct from item.updated_at then
      -- PT409 is a domain conflict, not a serialization failure that PostgREST retries.
      raise exception 'Item mudou; solicite nova proposta' using errcode = 'PT409';
    end if;
    result := public.mutate_item(item.id, payload->>'action', payload->'input');
  else raise exception 'Operação inválida' using errcode = '22023'; end if;
  select id into movement from public.movements where item_id = item.id and actor = auth.uid() order by id desc limit 1;
  insert into public.inventory_operations(actor, operation_id, payload, result, movement_id)
    values (auth.uid(), operation_id, payload, result, movement);
  return result;
end $$;
revoke all on function public.execute_inventory_operation(uuid,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.execute_inventory_operation(uuid,jsonb,timestamptz) to authenticated;
