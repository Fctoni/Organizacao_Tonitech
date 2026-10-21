alter table public.items add constraint aliases_without_null check (array_position(aliases, null) is null);
