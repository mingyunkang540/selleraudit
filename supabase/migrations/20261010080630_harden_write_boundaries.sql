begin;

-- Keep privileged implementation outside the exposed public schema. The
-- public RPC names remain stable for a future SellerRepository implementation.
create schema seller_audit_private;
revoke all on schema seller_audit_private from public, anon, authenticated;
grant usage on schema seller_audit_private to authenticated, service_role;

create function seller_audit_private.map_offer(
  p_offer_id uuid,
  p_master_product_id uuid
)
returns public.channel_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id uuid;
  v_raw_product_name text;
  v_raw_option_name text;
  v_source_channel text;
  v_offer public.channel_offers%rowtype;
begin
  if v_actor is null then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select o.workspace_id, l.product_name, o.option_name, c.channel_code
  into v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel
  from public.channel_offers o
  join public.channel_listings l
    on l.workspace_id = o.workspace_id and l.id = o.listing_id
  join public.channels c
    on c.workspace_id = l.workspace_id and c.id = l.channel_id
  join public.workspace_members wm
    on wm.workspace_id = o.workspace_id and wm.user_id = v_actor
  where o.id = p_offer_id
  for update of o;

  if not found then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  perform 1 from public.products p
  where p.workspace_id = v_workspace_id and p.id = p_master_product_id;
  if not found then
    raise exception 'Master product does not belong to the offer workspace.' using errcode = '23503';
  end if;

  update public.channel_offers
  set master_product_id = p_master_product_id
  where workspace_id = v_workspace_id and id = p_offer_id
  returning * into v_offer;

  insert into public.aliases (
    workspace_id, raw_product_name, raw_option_name, source_channel, master_product_id
  ) values (
    v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel, p_master_product_id
  )
  on conflict on constraint aliases_source_unique
  do update set master_product_id = excluded.master_product_id;

  update public.audit_issues
  set status = 'RESOLVED', resolved_at = coalesce(resolved_at, now())
  where workspace_id = v_workspace_id
    and issue_type = 'UNMATCHED'
    and status in ('OPEN', 'IN_PROGRESS')
    and offer_id = p_offer_id;

  return v_offer;
end;
$$;

create function seller_audit_private.update_issue_status(
  p_issue_id uuid,
  p_status text
)
returns public.audit_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id uuid;
  v_issue public.audit_issues%rowtype;
begin
  if p_status is null or p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED') then
    raise exception 'Invalid issue status: %', p_status using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select i.workspace_id into v_workspace_id
  from public.audit_issues i
  join public.workspace_members wm
    on wm.workspace_id = i.workspace_id and wm.user_id = v_actor
  where i.id = p_issue_id
  for update of i;
  if not found then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  update public.audit_issues
  set status = p_status,
      resolved_at = case when p_status = 'RESOLVED' then coalesce(resolved_at, now()) else null end
  where workspace_id = v_workspace_id and id = p_issue_id
  returning * into v_issue;
  return v_issue;
end;
$$;

revoke all on function seller_audit_private.map_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function seller_audit_private.update_issue_status(uuid, text) from public, anon, authenticated;
grant execute on function seller_audit_private.map_offer(uuid, uuid) to authenticated, service_role;
grant execute on function seller_audit_private.update_issue_status(uuid, text) to authenticated, service_role;

create or replace function public.map_offer(p_offer_id uuid, p_master_product_id uuid)
returns public.channel_offers
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.map_offer(p_offer_id, p_master_product_id);
$$;

create or replace function public.update_issue_status(p_issue_id uuid, p_status text)
returns public.audit_issues
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.update_issue_status(p_issue_id, p_status);
$$;

revoke all on function public.map_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_issue_status(uuid, text) from public, anon, authenticated;
grant execute on function public.map_offer(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_issue_status(uuid, text) to authenticated, service_role;

-- Column grants from the original invoker implementation are independent of
-- table grants, so revoke them explicitly before dropping the DML policies.
revoke update (master_product_id) on public.channel_offers from authenticated;
revoke insert (workspace_id, raw_product_name, raw_option_name, source_channel, master_product_id)
  on public.aliases from authenticated;
revoke update (master_product_id) on public.aliases from authenticated;
revoke update (status, resolved_at) on public.audit_issues from authenticated;

drop policy channel_offers_member_update on public.channel_offers;
drop policy aliases_member_insert on public.aliases;
drop policy aliases_member_update on public.aliases;
drop policy audit_issues_member_update on public.audit_issues;

commit;
