-- Additive: legacy clients can continue reading and writing the base table.
create or replace function public.historico_server_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.historico_server_updated_at() from public, anon, authenticated;

create trigger historico_server_updated_at
before insert or update on public.historico_orcamentos
for each row execute function public.historico_server_updated_at();

create index historico_orcamentos_sync_updated_id_idx
on public.historico_orcamentos(sync_key, updated_at, id);

create view public.historico_orcamentos_resumos
with (security_invoker = true)
as
select h.sync_key, h.id, h.updated_at, h.deleted_at,
  jsonb_build_object(
    'id', h.id, 'numero', h.numero, 'filial', h.filial,
    'gestor', h.data->>'gestor', 'data', h.data->>'data', 'total', h.data->>'total',
    'createdAt', coalesce(h.data->>'createdAt', h.record_created_at::text),
    'savedAt', coalesce(h.data->>'savedAt', h.saved_at::text),
    '__counts', jsonb_build_object('total', p.total, 'sent', p.sent, 'cut', p.cut, 'partial', p.partial)
  ) as summary
from public.historico_orcamentos h
cross join lateral (
  select count(*) as total,
    count(*) filter (where product->>'status' = 'sent') as sent,
    count(*) filter (where product->>'status' = 'cut') as cut,
    count(*) filter (where product->>'status' = 'partial') as partial
  from jsonb_array_elements(case when jsonb_typeof(h.data->'products') = 'array' then h.data->'products' else '[]'::jsonb end) product
) p;

revoke all on public.historico_orcamentos_resumos from public, anon;
grant select on public.historico_orcamentos_resumos to authenticated;
notify pgrst, 'reload schema';
