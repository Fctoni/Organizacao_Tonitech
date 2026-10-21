alter table public.access_members add column is_owner boolean not null default false;
-- One-time identity migration; never grant ownership by client email or to all ready members.
update public.access_members m set is_owner = true from auth.users u
where m.user_id = u.id and lower(u.email) = 'felipetonietto@gmail.com';

create function public.is_inventory_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_inventory_access() and exists (
    select 1 from public.access_members where user_id = auth.uid() and is_owner);
$$;
create table public.assistant_prompt_revisions (
  version integer generated always as identity primary key,
  body text not null check (length(btrim(body)) between 1 and 12000),
  author uuid,
  created_at timestamptz not null default now(),
  restored_from integer references public.assistant_prompt_revisions(version)
);
-- Author is an immutable audit identifier, retained even when an Auth account is deleted.
create table public.assistant_settings (
  singleton boolean primary key default true check(singleton),
  active_version integer not null references public.assistant_prompt_revisions(version)
);
insert into public.assistant_prompt_revisions(body) values ($prompt$
Ajude a organizar o inventário em português brasileiro, com respostas concisas que complementam os cartões.
Distinga a intenção de escolher onde guardar da intenção de cadastrar ou mover. Para “onde guardar”, investigue antes de pedir uma localização ao usuário.
Busque o nome e aliases. Se a busca nominal vier vazia, consulte categorias e amplie por categoria SEM manter a query nominal restritiva. Investigue Itens semelhantes e suas localizações completas (Shelf + Place). Fundamente sugestões nos Itens encontrados e cite essas evidências.
Uma localização com Itens semelhantes é apenas uma candidata. O inventário não informa espaço livre, capacidade ou disponibilidade física. Não invente essas condições nem recomende B02 ou outro endereço arbitrário como ideal. Peça ao usuário para verificar fisicamente a candidata quando necessário.
Não exija uma localização antes de ajudar a escolher. Quando faltarem evidências, explique a limitação e faça uma pergunta útil. Não transforme uma consulta em cadastro ou movimentação automática.
$prompt$);
insert into public.assistant_settings(active_version) select version from public.assistant_prompt_revisions;
alter table public.assistant_prompt_revisions enable row level security;
alter table public.assistant_settings enable row level security;
revoke all on public.assistant_prompt_revisions, public.assistant_settings from public, anon, authenticated;
-- No direct client grants: RPCs expose active revision to ready members and history only to owner.
create function public.reject_prompt_revision_change() returns trigger
language plpgsql set search_path = '' as $$ begin
  raise exception 'Revisões são imutáveis' using errcode = '42501';
end $$;
create trigger immutable_prompt_revision before update or delete on public.assistant_prompt_revisions
for each row execute function public.reject_prompt_revision_change();

create function public.assistant_prompt() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare revision jsonb;
begin
  if not public.has_inventory_access() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select to_jsonb(r) into revision from public.assistant_settings s join public.assistant_prompt_revisions r on r.version = s.active_version where singleton;
  if revision is null then raise exception 'Comportamento não configurado' using errcode = 'PT503'; end if;
  return revision || jsonb_build_object('canEdit', public.is_inventory_owner());
end $$;
create function public.assistant_prompt_history() returns jsonb
language plpgsql stable security definer set search_path = '' as $$ begin
  if not public.is_inventory_owner() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by version desc) from public.assistant_prompt_revisions r), '[]');
end $$;
create function public.save_assistant_prompt(expected_version bigint, new_body text, restore_version bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_version integer; revision public.assistant_prompt_revisions; content text;
begin
  if not public.is_inventory_owner() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select active_version into current_version from public.assistant_settings where singleton for update;
  if current_version is null then raise exception 'Comportamento não configurado' using errcode = 'PT503'; end if;
  if expected_version is distinct from current_version then raise exception 'Versão mudou; recarregue antes de salvar' using errcode = 'PT409'; end if;
  if restore_version is not null then
    if new_body is not null then raise exception 'Restauração inválida' using errcode = '22023'; end if;
    select body into content from public.assistant_prompt_revisions where version = restore_version;
    if content is null then raise exception 'Revisão inexistente' using errcode = '22023'; end if;
  else content := btrim(new_body); end if;
  if content is null or length(btrim(content)) not between 1 and 12000 then raise exception 'Use de 1 a 12000 caracteres' using errcode = '23514'; end if;
  insert into public.assistant_prompt_revisions(body, author, restored_from) values(content, auth.uid(), restore_version) returning * into revision;
  update public.assistant_settings set active_version = revision.version where singleton;
  return to_jsonb(revision) || jsonb_build_object('canEdit', true);
end $$;
revoke all on function public.is_inventory_owner(), public.assistant_prompt(), public.assistant_prompt_history(), public.save_assistant_prompt(bigint,text,bigint), public.reject_prompt_revision_change() from public, anon, authenticated;
grant execute on function public.is_inventory_owner(), public.assistant_prompt(), public.assistant_prompt_history(), public.save_assistant_prompt(bigint,text,bigint) to authenticated;
