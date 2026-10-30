-- Run after the additive migration. Synthetic writes are rolled back.
begin;
create temporary table egress_verification(check_name text, passed boolean);
insert into egress_verification
select 'summary_count_matches',
  (select count(*) from public.historico_orcamentos) =
  (select count(*) from public.historico_orcamentos_resumos);
insert into egress_verification
select 'summary_contains_no_products', not exists (
  select 1 from public.historico_orcamentos_resumos where summary ? 'products'
);
insert into egress_verification
select 'summary_counts_match_products', not exists (
  select 1 from public.historico_orcamentos_resumos v
  join public.historico_orcamentos h using(sync_key,id)
  where (v.summary->'__counts'->>'total')::bigint <>
    jsonb_array_length(case when jsonb_typeof(h.data->'products')='array' then h.data->'products' else '[]'::jsonb end)
);
insert into egress_verification
select 'anon_cannot_read_summary', not has_table_privilege('anon','public.historico_orcamentos_resumos','select');
insert into egress_verification
select 'authenticated_summary_is_read_only',
  has_table_privilege('authenticated','public.historico_orcamentos_resumos','select')
  and not has_table_privilege('authenticated','public.historico_orcamentos_resumos','insert,update,delete,truncate,references,trigger');
insert into egress_verification
select 'view_is_security_invoker', 'security_invoker=true'=any(reloptions)
from pg_class where oid='public.historico_orcamentos_resumos'::regclass;
do $test$
declare p record; base_count bigint; view_count bigint; tested integer:=0;
begin
  for p in select id from public.app_profiles loop
    perform set_config('request.jwt.claim.sub',p.id::text,true);
    set local role authenticated;
    select count(*) into base_count from public.historico_orcamentos;
    select count(*) into view_count from public.historico_orcamentos_resumos;
    reset role;
    if base_count<>view_count then raise exception 'RLS mismatch'; end if;
    tested:=tested+1;
  end loop;
  insert into egress_verification values('RLS_matches_for_all_profiles',tested>0);
end
$test$;
insert into public.historico_orcamentos(sync_key,id,data,updated_at)
values ('transferencia','__egress_rollback_verification__','{"products":[]}','2099-01-01');
insert into egress_verification
select 'insert_timestamp_is_server_generated',updated_at<'2099-01-01'::timestamptz
from public.historico_orcamentos where id='__egress_rollback_verification__';
update public.historico_orcamentos set deleted_at=now(),updated_at='2099-01-01'
where id='__egress_rollback_verification__';
insert into egress_verification
select 'update_timestamp_and_tombstone',updated_at<'2099-01-01'::timestamptz and deleted_at is not null
from public.historico_orcamentos_resumos where id='__egress_rollback_verification__';
do $test$
declare p record; allowed boolean; wrote boolean; changed bigint; n integer:=0; server_stamp boolean;
begin
  for p in select id,operator_name from public.app_profiles loop
    n:=n+1;
    allowed:=upper(p.operator_name) in ('MASTER','TRANSFERENCIA');
    perform set_config('request.jwt.claim.sub',p.id::text,true);
    set local role authenticated;
    wrote:=false;
    begin
      insert into public.historico_orcamentos(sync_key,id,data,updated_at)
      values('transferencia','__egress_role_test_'||n,'{"products":[]}','2099-01-01');
      wrote:=true;
    exception when insufficient_privilege then
      wrote:=false;
    end;
    update public.historico_orcamentos set updated_at='2099-01-01'
    where id='__egress_rollback_verification__';
    get diagnostics changed=row_count;
    reset role;
    if wrote<>allowed or (changed=1)<>allowed then raise exception 'Write role permissions changed'; end if;
  end loop;
  insert into egress_verification values('RLS_write_roles_match_existing_policy',n>0);
  select not exists(select 1 from public.historico_orcamentos where id like '__egress_role_test_%' and updated_at>='2099-01-01') into server_stamp;
  insert into egress_verification values('authenticated_trigger_assigns_timestamp',server_stamp);
end
$test$;
select * from egress_verification order by check_name;
rollback;
