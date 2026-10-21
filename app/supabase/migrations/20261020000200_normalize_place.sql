create function public.normalize_item_place() returns trigger
language plpgsql set search_path = '' as $$
declare position text;
begin
  if new.place ~ '^[BW][0-9]{2,9}$' then
    position := (substring(new.place from 2)::integer)::text;
    new.place := left(new.place, 1) || lpad(position, greatest(2, length(position)), '0');
  end if;
  return new;
end $$;
revoke all on function public.normalize_item_place() from public, anon, authenticated;
create trigger normalize_place before insert or update of place on public.items
for each row execute function public.normalize_item_place();
