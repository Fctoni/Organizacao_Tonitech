-- Match ECMAScript String.trim() and String.length / textarea maxlength (UTF-16).
-- Incremental: never rewrite immutable revisions or reassign ownership.
create function public.normalize_assistant_prompt(body text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare content text; units integer := 0; i integer;
begin
  content := btrim(body, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if length(content) not between 1 and 12000 then
    raise exception 'Use de 1 a 12000 unidades UTF-16 após remover espaços nas extremidades' using errcode = '23514';
  end if;
  for i in 1..length(content) loop
    units := units + case when ascii(substr(content, i, 1)) > 65535 then 2 else 1 end;
  end loop;
  if units > 12000 then
    raise exception 'Use no máximo 12000 unidades UTF-16' using errcode = '23514';
  end if;
  return content;
end $$;
revoke all on function public.normalize_assistant_prompt(text) from public, anon, authenticated;

-- Validate existing rows without changing them. Invalid legacy data aborts migration.
alter table public.assistant_prompt_revisions drop constraint assistant_prompt_revisions_body_check;
alter table public.assistant_prompt_revisions add constraint assistant_prompt_revisions_body_check
  check (public.normalize_assistant_prompt(body) is not null);

create or replace function public.save_assistant_prompt(expected_version bigint, new_body text, restore_version bigint default null) returns jsonb
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
  else content := new_body; end if;
  content := public.normalize_assistant_prompt(content);
  if content is null then raise exception 'Comportamento obrigatório' using errcode = '23514'; end if;
  insert into public.assistant_prompt_revisions(body, author, restored_from) values(content, auth.uid(), restore_version) returning * into revision;
  update public.assistant_settings set active_version = revision.version where singleton;
  return to_jsonb(revision) || jsonb_build_object('canEdit', true);
end $$;
