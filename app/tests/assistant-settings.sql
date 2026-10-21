-- Run against local Supabase only. All fixtures and revisions roll back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
insert into public.access_members(user_id, password_changed_at, is_owner) values
('00000000-0000-4000-8000-000000000001', '2020-01-01', true),
('00000000-0000-4000-8000-000000000002', '2020-01-01', false),
('00000000-0000-4000-8000-000000000003', null, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","iat":2000000000}', true);
do $$ begin
  assert (public.assistant_prompt()->>'canEdit')::boolean = false;
  begin perform public.save_assistant_prompt(1, 'Novo comportamento', null); raise exception 'member saved'; exception when insufficient_privilege then null; end;
  begin perform public.assistant_prompt_history(); raise exception 'member history'; exception when insufficient_privilege then null; end;
  begin update public.access_members set is_owner = true; raise exception 'self promotion'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","iat":2000000000}', true);
do $$ begin
  begin perform public.assistant_prompt(); raise exception 'pending read'; exception when insufficient_privilege then null; end;
  begin perform public.save_assistant_prompt(1, 'Novo comportamento', null); raise exception 'pending saved'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","iat":2000000000}', true);
do $$ declare original bigint; next_version bigint; restored jsonb; begin
  original := (public.assistant_prompt()->>'version')::bigint;
  assert (public.assistant_prompt()->>'canEdit')::boolean;
  next_version := (public.save_assistant_prompt(original, 'Comportamento fixture', null)->>'version')::bigint;
  assert next_version > original;
  begin perform public.save_assistant_prompt(original, 'Conflito', null); raise exception 'stale saved'; exception when sqlstate 'PT409' then null; end;
  begin perform public.save_assistant_prompt(next_version, ' ', null); raise exception 'empty saved'; exception when check_violation then null; end;
  begin perform public.save_assistant_prompt(next_version, repeat('a',12001), null); raise exception 'large saved'; exception when check_violation then null; end;
  restored := public.save_assistant_prompt(next_version, null, original);
  assert (restored->>'version')::bigint > next_version;
  assert (restored->>'restored_from')::bigint = original;
  assert restored->>'author' = '00000000-0000-4000-8000-000000000001';
  begin perform public.save_assistant_prompt((restored->>'version')::bigint, null, 2147483647); raise exception 'missing restored'; exception when invalid_parameter_value then null; end;
  assert jsonb_array_length(public.assistant_prompt_history()) >= 3;
  begin update public.assistant_prompt_revisions set body = 'changed'; raise exception 'updated'; exception when insufficient_privilege then null; end;
  begin delete from public.assistant_prompt_revisions; raise exception 'deleted'; exception when insufficient_privilege then null; end;
end $$;
do $$ declare current_version bigint; count_before integer; invalid text; saved jsonb; begin
  current_version := (public.assistant_prompt()->>'version')::bigint;
  count_before := jsonb_array_length(public.assistant_prompt_history());
  foreach invalid in array array[E'\t', E'\n\r', E' \t\n ', U&'\00A0\FEFF\2028', repeat('😀',6001), repeat('😀',7000)] loop
    begin
      perform public.save_assistant_prompt(current_version, invalid, null);
      raise exception 'invalid whitespace/UTF16 accepted';
    exception when check_violation then null; end;
    assert (public.assistant_prompt()->>'version')::bigint = current_version;
    assert jsonb_array_length(public.assistant_prompt_history()) = count_before;
  end loop;
  saved := public.save_assistant_prompt(current_version, E'\t\n' || repeat('😀',6000) || U&'\FEFF', null);
  assert saved->>'body' = repeat('😀',6000);
  assert public.assistant_prompt()->>'body' = saved->>'body';
  saved := public.save_assistant_prompt((saved->>'version')::bigint, null, (saved->>'version')::bigint);
  assert saved->>'body' = repeat('😀',6000);
end $$;
reset role;
delete from public.assistant_settings;
set local role authenticated;
do $$ begin
  begin perform public.assistant_prompt(); raise exception 'missing configuration accepted'; exception when sqlstate 'PT503' then null; end;
  begin perform public.save_assistant_prompt(1, 'Missing', null); raise exception 'missing saved'; exception when sqlstate 'PT503' then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.assistant_prompt(); raise exception 'anonymous read'; exception when insufficient_privilege then null; end;
end $$;
rollback;
