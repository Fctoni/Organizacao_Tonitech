-- One statement snapshot: quantities and audit trail refer to the same database state.
create function public.export_inventory() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('version', 1,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by id) from public.items i), '[]'),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by id) from public.movements m), '[]'),
    'originals', coalesce((select jsonb_agg(to_jsonb(s) order by filename) from public.source_snapshots s), '[]'));
$$;
revoke all on function public.export_inventory() from public, anon, authenticated;
grant execute on function public.export_inventory() to service_role;
