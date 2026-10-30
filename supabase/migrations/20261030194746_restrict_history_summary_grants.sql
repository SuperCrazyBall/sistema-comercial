-- Supabase default privileges also grant writes on newly created views.
revoke all on public.historico_orcamentos_resumos from authenticated;
grant select on public.historico_orcamentos_resumos to authenticated;
notify pgrst, 'reload schema';
