-- Local mapping/audit parity. Actor and workspace come only from authenticated server session.

create or replace function seller_audit_local.map_offer(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_offer_id uuid,
  p_master_product_id uuid
)
returns seller_audit_local.channel_offers
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_workspace_id uuid;
  v_raw_product_name text;
  v_raw_option_name text;
  v_source_channel text;
  v_offer seller_audit_local.channel_offers%rowtype;
begin
  if v_actor is null then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select o.workspace_id, l.product_name, o.option_name, c.channel_code
  into v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel
  from seller_audit_local.channel_offers o
  join seller_audit_local.channel_listings l
    on l.workspace_id = o.workspace_id and l.id = o.listing_id
  join seller_audit_local.channels c
    on c.workspace_id = l.workspace_id and c.id = l.channel_id
  join seller_audit_local.workspace_members wm
    on wm.workspace_id = o.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role in ('ADMIN', 'EDITOR')
  join seller_audit_local.app_users au on au.id = wm.user_id and au.status = 'ACTIVE'
  where o.id = p_offer_id and o.workspace_id = p_workspace_id
  for update of o, wm, au;

  if not found then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  perform 1 from seller_audit_local.products p
  where p.workspace_id = v_workspace_id and p.id = p_master_product_id;
  if not found then
    raise exception 'Master product does not belong to the offer workspace.' using errcode = '23503';
  end if;

  update seller_audit_local.channel_offers
  set master_product_id = p_master_product_id
  where workspace_id = v_workspace_id and id = p_offer_id
  returning * into v_offer;

  insert into seller_audit_local.aliases (
    workspace_id, raw_product_name, raw_option_name, source_channel, master_product_id
  ) values (
    v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel, p_master_product_id
  )
  on conflict on constraint aliases_source_unique
  do update set master_product_id = excluded.master_product_id;

  update seller_audit_local.audit_issues
  set status = 'RESOLVED', resolved_at = coalesce(resolved_at, now())
  where workspace_id = v_workspace_id
    and issue_type = 'UNMATCHED'
    and status in ('OPEN', 'IN_PROGRESS')
    and offer_id = p_offer_id;

  return v_offer;
end;
$$;

create or replace function seller_audit_local.update_issue_status(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_issue_id uuid,
  p_status text
)
returns seller_audit_local.audit_issues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_workspace_id uuid;
  v_issue seller_audit_local.audit_issues%rowtype;
begin
  if p_status is null or p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED') then
    raise exception 'Invalid issue status: %', p_status using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select i.workspace_id into v_workspace_id
  from seller_audit_local.audit_issues i
  join seller_audit_local.workspace_members wm
    on wm.workspace_id = i.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role in ('ADMIN', 'EDITOR')
  join seller_audit_local.app_users au on au.id = wm.user_id and au.status = 'ACTIVE'
  where i.id = p_issue_id and i.workspace_id = p_workspace_id
  for update of i, wm, au;
  if not found then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  update seller_audit_local.audit_issues
  set status = p_status,
      resolved_at = case when p_status = 'RESOLVED' then coalesce(resolved_at, now()) else null end
  where workspace_id = v_workspace_id and id = p_issue_id
  returning * into v_issue;
  return v_issue;
end;
$$;

REVOKE ALL ON FUNCTION seller_audit_local.map_offer(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION seller_audit_local.update_issue_status(uuid,uuid,uuid,text) FROM PUBLIC;
