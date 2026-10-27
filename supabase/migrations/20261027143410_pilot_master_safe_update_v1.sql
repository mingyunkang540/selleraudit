begin;

create or replace function seller_audit_private.preview_master_import_apply(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.import_batches%rowtype;
  v_candidate public.import_candidates%rowtype;
  v_effective jsonb;
  v_canonical_effective jsonb;
  v_existing_product public.products%rowtype;
  v_existing_sku public.skus%rowtype;
  v_existing_component public.product_components%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_product_by_row jsonb := '{}'::jsonb;
  v_product_by_code jsonb := '{}'::jsonb;
  v_sku_by_code jsonb := '{}'::jsonb;
  v_bom_by_key jsonb := '{}'::jsonb;
  v_changes jsonb;
  v_status text;
  v_reason text;
  v_business_key text;
  v_product_code text;
  v_sku_code text;
  v_product_name text;
  v_product_type text;
  v_model_name text;
  v_category text;
  v_color text;
  v_variant_source_row integer;
  v_product_source_row integer;
  v_quantity integer;
  v_blocking_batch_issues integer;
  v_source_trusted boolean;
  v_product_new integer := 0;
  v_product_update integer := 0;
  v_product_unchanged integer := 0;
  v_product_conflict integer := 0;
  v_product_skipped integer := 0;
  v_sku_new integer := 0;
  v_sku_update integer := 0;
  v_sku_unchanged integer := 0;
  v_sku_conflict integer := 0;
  v_sku_skipped integer := 0;
  v_bom_new integer := 0;
  v_bom_update integer := 0;
  v_bom_unchanged integer := 0;
  v_bom_conflict integer := 0;
  v_bom_skipped integer := 0;
  v_conflicts integer;
  v_change_count integer;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'Batch ID is required.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.import_batches
  where id = p_batch_id;
  if not found then
    raise exception 'Import batch does not exist.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = v_batch.workspace_id
      and member.user_id = v_actor
      and member.status = 'ACTIVE'
      and member.role in ('ADMIN', 'EDITOR')
  ) then
    raise exception 'Actor is not authorized for this import batch.' using errcode = '42501';
  end if;

  select count(*)::integer into v_blocking_batch_issues
  from public.import_validation_issues issue
  where issue.workspace_id = v_batch.workspace_id
    and issue.import_batch_id = v_batch.id
    and issue.validation_revision = v_batch.validation_revision
    and issue.blocking_scope = 'BATCH'
    and issue.status = 'OPEN';

  select exists (
    select 1
    from public.import_source_files source_file
    where source_file.id = v_batch.source_file_id
      and source_file.workspace_id = v_batch.workspace_id
      and source_file.source_type = 'MASTER_WORKBOOK'
      and source_file.verification_status = 'VERIFIED'
      and source_file.server_verified_sha256 = v_batch.source_file_hash
      and v_batch.source_type = 'MASTER_WORKBOOK'
      and v_batch.source_hash_verification = 'SERVER_VERIFIED'
  ) into v_source_trusted;

  for v_candidate in
    select candidate.*
    from public.import_candidates candidate
    where candidate.workspace_id = v_batch.workspace_id
      and candidate.import_batch_id = v_batch.id
      and candidate.validation_revision = v_batch.validation_revision
    order by
      case candidate.kind when 'PRODUCT' then 1 when 'SKU' then 2 else 3 end,
      case when candidate.kind = 'PRODUCT'
        and candidate.normalized_values->'variantOfSourceRow' is not null
        and candidate.normalized_values->'variantOfSourceRow' <> 'null'::jsonb
        then 1 else 0 end,
      candidate.candidate_ordinal
  loop
    -- jsonb concatenation deliberately preserves reviewed explicit null values.
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    v_changes := '{}'::jsonb;
    v_status := null;
    v_reason := null;
    v_business_key := '';

    if v_candidate.candidate_status <> 'VALID' then
      v_status := case v_candidate.candidate_status
        when 'WARNING' then 'SKIPPED_WARNING'
        when 'ERROR' then 'SKIPPED_ERROR'
        when 'DEFERRED' then 'SKIPPED_DEFERRED'
        else 'SKIPPED_INVALID'
      end;
      v_reason := 'Candidate status is ' || v_candidate.candidate_status || '.';
    end if;

    if v_candidate.kind = 'PRODUCT' then
      v_product_code := btrim(coalesce(v_effective->>'sabangnetCode', ''));
      v_product_name := btrim(coalesce(v_effective->>'productName', ''));
      v_product_type := v_effective->>'productType';
      v_category := v_effective->>'category';
      v_variant_source_row := null;
      if jsonb_typeof(v_effective->'variantOfSourceRow') = 'number'
         and (v_effective->>'variantOfSourceRow')::numeric = trunc((v_effective->>'variantOfSourceRow')::numeric)
         and (v_effective->>'variantOfSourceRow')::numeric between 1 and 2147483647 then
        v_variant_source_row := (v_effective->>'variantOfSourceRow')::integer;
      end if;

      if v_status is null and v_variant_source_row is not null then
        select canonical.normalized_values || coalesce(canonical.reviewed_values, '{}'::jsonb)
          into v_canonical_effective
        from public.import_candidates canonical
        where canonical.workspace_id = v_batch.workspace_id
          and canonical.import_batch_id = v_batch.id
          and canonical.validation_revision = v_batch.validation_revision
          and canonical.kind = 'PRODUCT'
          and canonical.source_row = v_variant_source_row
        order by canonical.candidate_ordinal
        limit 1;
        if not found then
          v_status := 'SKIPPED_DEPENDENCY';
          v_reason := 'Canonical product source row is unavailable.';
        else
          v_product_code := btrim(coalesce(v_canonical_effective->>'sabangnetCode', ''));
        end if;
      end if;
      v_business_key := v_product_code;

      if v_status is null and (
        v_product_code = '' or v_product_name = ''
        or coalesce(v_product_type, '') not in ('SINGLE', 'SET')
      ) then
        v_status := 'SKIPPED_INVALID';
        v_reason := 'Product requires sabangnetCode, productName, and SINGLE or SET productType.';
      end if;

      if v_status is null and v_variant_source_row is not null then
        if coalesce(v_product_by_code->v_product_code->>'status', '') in ('NEW', 'UPDATE', 'UNCHANGED') then
          v_status := 'UNCHANGED';
          v_reason := 'Variant reuses its canonical Product.';
        else
          v_status := 'SKIPPED_DEPENDENCY';
          v_reason := 'Canonical Product is not applyable.';
        end if;
      end if;

      if v_status is null and v_product_by_code ? v_product_code
         and coalesce(v_product_by_code->v_product_code->>'status', '')
           in ('NEW', 'UPDATE', 'UNCHANGED', 'CONFLICT') then
        if (v_product_by_code->v_product_code->'values') = jsonb_build_object(
          'productName', v_product_name,
          'category', to_jsonb(v_category),
          'productType', v_product_type
        ) then
          v_status := 'UNCHANGED';
          v_reason := 'Equivalent Product is already represented in this batch.';
        else
          v_status := 'CONFLICT';
          v_reason := 'The batch contains different Product values for the same business key.';
        end if;
      end if;

      if v_status is null then
        select * into v_existing_product
        from public.products product
        where product.workspace_id = v_batch.workspace_id
          and product.sabangnet_code = v_product_code;
        if not found then
          v_status := 'NEW';
        elsif v_existing_product.product_type <> v_product_type then
          v_status := 'CONFLICT';
          v_reason := 'Product Type changes are not applied automatically.';
        elsif v_existing_product.product_name = v_product_name
          and v_existing_product.category is not distinct from v_category then
          v_status := 'UNCHANGED';
        else
          v_status := 'UPDATE';
          if v_existing_product.product_name is distinct from v_product_name then
            v_changes := v_changes || jsonb_build_object('productName', jsonb_build_object(
              'before', v_existing_product.product_name,
              'after', v_product_name
            ));
          end if;
          if v_existing_product.category is distinct from v_category then
            v_changes := v_changes || jsonb_build_object('category', jsonb_build_object(
              'before', to_jsonb(v_existing_product.category),
              'after', to_jsonb(v_category)
            ));
          end if;
        end if;
      end if;

      v_product_by_row := jsonb_set(v_product_by_row, array[v_candidate.source_row::text], to_jsonb(v_product_code), true);
      if not (v_product_by_code ? v_product_code)
         or coalesce(v_product_by_code->v_product_code->>'status', '')
           not in ('NEW', 'UPDATE', 'UNCHANGED')
         or v_status = 'CONFLICT' then
        v_product_by_code := jsonb_set(v_product_by_code, array[v_product_code], jsonb_build_object(
          'status', v_status,
          'values', jsonb_build_object(
            'productName', v_product_name,
            'category', to_jsonb(v_category),
            'productType', v_product_type
          )
        ), true);
      end if;

      case
        when v_status = 'NEW' then v_product_new := v_product_new + 1;
        when v_status = 'UPDATE' then v_product_update := v_product_update + 1;
        when v_status = 'UNCHANGED' then v_product_unchanged := v_product_unchanged + 1;
        when v_status = 'CONFLICT' then v_product_conflict := v_product_conflict + 1;
        else v_product_skipped := v_product_skipped + 1;
      end case;

    elsif v_candidate.kind = 'SKU' then
      v_sku_code := btrim(coalesce(v_effective->>'skuCode', ''));
      v_model_name := btrim(coalesce(v_effective->>'modelName', ''));
      v_color := v_effective->>'color';
      v_business_key := v_sku_code;

      if v_status is null and (v_sku_code = '' or v_model_name = '') then
        v_status := 'SKIPPED_INVALID';
        v_reason := 'SKU requires skuCode and modelName.';
      end if;

      if v_status is null and v_sku_by_code ? v_sku_code
         and coalesce(v_sku_by_code->v_sku_code->>'status', '')
           in ('NEW', 'UPDATE', 'UNCHANGED', 'CONFLICT') then
        if (v_sku_by_code->v_sku_code->'values') = jsonb_build_object(
          'modelName', v_model_name,
          'color', to_jsonb(v_color)
        ) then
          v_status := 'UNCHANGED';
          v_reason := 'Equivalent SKU is already represented in this batch.';
        else
          v_status := 'CONFLICT';
          v_reason := 'The batch contains different SKU values for the same business key.';
        end if;
      end if;

      if v_status is null then
        select * into v_existing_sku
        from public.skus sku
        where sku.workspace_id = v_batch.workspace_id
          and sku.sku_code = v_sku_code;
        if not found then
          v_status := 'NEW';
        elsif v_existing_sku.model_name = v_model_name
          and v_existing_sku.color is not distinct from v_color then
          v_status := 'UNCHANGED';
        else
          v_status := 'UPDATE';
          if v_existing_sku.model_name is distinct from v_model_name then
            v_changes := v_changes || jsonb_build_object('modelName', jsonb_build_object(
              'before', v_existing_sku.model_name,
              'after', v_model_name
            ));
          end if;
          if v_existing_sku.color is distinct from v_color then
            v_changes := v_changes || jsonb_build_object('color', jsonb_build_object(
              'before', to_jsonb(v_existing_sku.color),
              'after', to_jsonb(v_color)
            ));
          end if;
        end if;
      end if;

      if not (v_sku_by_code ? v_sku_code)
         or coalesce(v_sku_by_code->v_sku_code->>'status', '')
           not in ('NEW', 'UPDATE', 'UNCHANGED')
         or v_status = 'CONFLICT' then
        v_sku_by_code := jsonb_set(v_sku_by_code, array[v_sku_code], jsonb_build_object(
          'status', v_status,
          'values', jsonb_build_object('modelName', v_model_name, 'color', to_jsonb(v_color))
        ), true);
      end if;

      case
        when v_status = 'NEW' then v_sku_new := v_sku_new + 1;
        when v_status = 'UPDATE' then v_sku_update := v_sku_update + 1;
        when v_status = 'UNCHANGED' then v_sku_unchanged := v_sku_unchanged + 1;
        when v_status = 'CONFLICT' then v_sku_conflict := v_sku_conflict + 1;
        else v_sku_skipped := v_sku_skipped + 1;
      end case;

    else
      v_product_code := btrim(coalesce(v_effective->>'productCode', ''));
      v_sku_code := btrim(coalesce(v_effective->>'skuCode', ''));
      v_product_source_row := null;
      v_quantity := null;
      if jsonb_typeof(v_effective->'productSourceRow') = 'number'
         and (v_effective->>'productSourceRow')::numeric = trunc((v_effective->>'productSourceRow')::numeric)
         and (v_effective->>'productSourceRow')::numeric between 1 and 2147483647 then
        v_product_source_row := (v_effective->>'productSourceRow')::integer;
      end if;
      if v_product_source_row is not null and v_product_by_row ? v_product_source_row::text then
        v_product_code := v_product_by_row->>v_product_source_row::text;
      end if;
      if jsonb_typeof(v_effective->'quantity') = 'number'
         and (v_effective->>'quantity')::numeric = trunc((v_effective->>'quantity')::numeric)
         and (v_effective->>'quantity')::numeric between 1 and 2147483647 then
        v_quantity := (v_effective->>'quantity')::integer;
      end if;
      v_business_key := v_product_code || '|' || v_sku_code;

      if v_status is null and (v_product_code = '' or v_sku_code = '' or v_quantity is null) then
        v_status := 'SKIPPED_INVALID';
        v_reason := 'BOM requires a Product, SKU, and positive integer quantity.';
      end if;

      if v_status is null and (
        not (
          coalesce(v_product_by_code->v_product_code->>'status', '') in ('NEW', 'UPDATE', 'UNCHANGED')
          or exists (
            select 1 from public.products product
            where product.workspace_id = v_batch.workspace_id
              and product.sabangnet_code = v_product_code
          )
        )
        or not (
          coalesce(v_sku_by_code->v_sku_code->>'status', '') in ('NEW', 'UPDATE', 'UNCHANGED')
          or exists (
            select 1 from public.skus sku
            where sku.workspace_id = v_batch.workspace_id
              and sku.sku_code = v_sku_code
          )
        )
      ) then
        v_status := 'SKIPPED_DEPENDENCY';
        v_reason := 'BOM Product or SKU dependency is unavailable.';
      end if;

      if v_status is null and v_bom_by_key ? v_business_key then
        if (v_bom_by_key->>v_business_key)::integer = v_quantity then
          v_status := 'UNCHANGED';
          v_reason := 'Equivalent BOM is already represented in this batch.';
        else
          v_status := 'CONFLICT';
          v_reason := 'The batch contains a different quantity for the same BOM business key.';
        end if;
      end if;

      if v_status is null then
        select * into v_existing_product from public.products product
        where product.workspace_id = v_batch.workspace_id and product.sabangnet_code = v_product_code;
        select * into v_existing_sku from public.skus sku
        where sku.workspace_id = v_batch.workspace_id and sku.sku_code = v_sku_code;
        if v_existing_product.id is null or v_existing_sku.id is null then
          v_status := 'NEW';
        else
          select * into v_existing_component from public.product_components component
          where component.workspace_id = v_batch.workspace_id
            and component.product_id = v_existing_product.id
            and component.sku_id = v_existing_sku.id;
          if not found then
            v_status := 'NEW';
          elsif v_existing_component.quantity = v_quantity then
            v_status := 'UNCHANGED';
          else
            v_status := 'UPDATE';
            v_changes := jsonb_build_object('quantity', jsonb_build_object(
              'before', v_existing_component.quantity,
              'after', v_quantity
            ));
          end if;
        end if;
      end if;

      if v_status in ('NEW', 'UPDATE', 'UNCHANGED') and not (v_bom_by_key ? v_business_key) then
        v_bom_by_key := jsonb_set(v_bom_by_key, array[v_business_key], to_jsonb(v_quantity), true);
      end if;
      case
        when v_status = 'NEW' then v_bom_new := v_bom_new + 1;
        when v_status = 'UPDATE' then v_bom_update := v_bom_update + 1;
        when v_status = 'UNCHANGED' then v_bom_unchanged := v_bom_unchanged + 1;
        when v_status = 'CONFLICT' then v_bom_conflict := v_bom_conflict + 1;
        else v_bom_skipped := v_bom_skipped + 1;
      end case;
    end if;

    -- Omit optional top-level keys without stripping explicit null values
    -- nested inside an UPDATE before/after diff.
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'candidateId', v_candidate.id,
        'kind', v_candidate.kind,
        'status', v_status,
        'businessKey', v_business_key
      )
      || case when v_reason is null then '{}'::jsonb
           else jsonb_build_object('reason', v_reason) end
      || case when v_status = 'UPDATE' then jsonb_build_object('changes', v_changes)
           else '{}'::jsonb end
    );
  end loop;

  v_conflicts := v_product_conflict + v_sku_conflict + v_bom_conflict;
  v_change_count := v_product_new + v_product_update
    + v_sku_new + v_sku_update
    + v_bom_new + v_bom_update;
  return jsonb_build_object(
    'batchId', v_batch.id,
    'canApply', v_batch.status = 'REVIEW_REQUIRED'
      and v_source_trusted
      and v_blocking_batch_issues = 0
      and v_conflicts = 0
      and v_change_count > 0,
    'blockingBatchIssues', v_blocking_batch_issues,
    'productNew', v_product_new,
    'productUpdate', v_product_update,
    'productUnchanged', v_product_unchanged,
    'productConflict', v_product_conflict,
    'productSkipped', v_product_skipped,
    'skuNew', v_sku_new,
    'skuUpdate', v_sku_update,
    'skuUnchanged', v_sku_unchanged,
    'skuConflict', v_sku_conflict,
    'skuSkipped', v_sku_skipped,
    'bomNew', v_bom_new,
    'bomUpdate', v_bom_update,
    'bomUnchanged', v_bom_unchanged,
    'bomConflict', v_bom_conflict,
    'bomSkipped', v_bom_skipped,
    'rows', v_rows
  );
end;
$$;

create or replace function public.preview_master_import_apply(p_batch_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.preview_master_import_apply(p_batch_id);
$$;

create or replace function seller_audit_private.apply_master_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_ref uuid;
  v_batch public.import_batches%rowtype;
  v_preview jsonb;
  v_row jsonb;
  v_candidate public.import_candidates%rowtype;
  v_effective jsonb;
  v_reference_effective jsonb;
  v_product_code text;
  v_sku_code text;
  v_product_source_row integer;
  v_product_id uuid;
  v_sku_id uuid;
  v_component_id uuid;
  v_quantity integer;
  v_product_created integer;
  v_product_updated integer;
  v_sku_created integer;
  v_sku_updated integer;
  v_bom_created integer;
  v_bom_updated integer;
  v_skipped integer;
  v_remaining integer;
  v_final_status text;
  v_correlation_id uuid := gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into v_batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if not found then
    raise exception 'Import batch does not exist.' using errcode = 'P0002';
  end if;

  select member.actor_ref into v_actor_ref
  from public.workspace_members member
  where member.workspace_id = v_batch.workspace_id
    and member.user_id = v_actor
    and member.status = 'ACTIVE'
    and member.role = 'ADMIN'
  for share;
  if not found then
    raise exception 'Only an active ADMIN can apply an import batch.' using errcode = '42501';
  end if;
  if v_batch.status <> 'REVIEW_REQUIRED' then
    raise exception 'Import batch is not eligible for apply.' using errcode = '55000';
  end if;

  -- Serialize every Apply in one workspace. This closes the cross-batch
  -- NEW/UPDATE race that row locks alone cannot prevent for absent keys.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_batch.workspace_id::text, 0)
  );

  -- Freeze review inputs and all existing workspace master rows before the
  -- authoritative preview is recomputed. Unique business-key constraints
  -- remain the final guard against concurrent inserts from another batch.
  perform 1 from public.import_source_files
    where id = v_batch.source_file_id and workspace_id = v_batch.workspace_id
    for share;
  perform 1 from public.import_candidates
    where import_batch_id = v_batch.id and workspace_id = v_batch.workspace_id
    for update;
  perform 1 from public.import_validation_issues
    where import_batch_id = v_batch.id and workspace_id = v_batch.workspace_id
    for update;
  perform 1 from public.products
    where workspace_id = v_batch.workspace_id
    order by id
    for update;
  perform 1 from public.skus
    where workspace_id = v_batch.workspace_id
    order by id
    for update;
  perform 1 from public.product_components
    where workspace_id = v_batch.workspace_id
    order by id
    for update;

  v_preview := seller_audit_private.preview_master_import_apply(p_batch_id);
  if not (v_preview->>'canApply')::boolean then
    raise exception 'Import batch preview is not applyable.' using errcode = '55000';
  end if;

  for v_row in select value from jsonb_array_elements(v_preview->'rows')
    where value->>'kind' = 'PRODUCT' and value->>'status' = 'NEW'
  loop
    select * into strict v_candidate from public.import_candidates where id = (v_row->>'candidateId')::uuid;
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    insert into public.products (
      workspace_id, sabangnet_code, product_name, category, product_type, normal_price, status
    ) values (
      v_batch.workspace_id,
      btrim(v_effective->>'sabangnetCode'),
      btrim(v_effective->>'productName'),
      v_effective->>'category',
      v_effective->>'productType',
      null,
      'ACTIVE'
    );
  end loop;

  for v_row in select value from jsonb_array_elements(v_preview->'rows')
    where value->>'kind' = 'PRODUCT' and value->>'status' = 'UPDATE'
  loop
    select * into strict v_candidate from public.import_candidates where id = (v_row->>'candidateId')::uuid;
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    update public.products
    set product_name = btrim(v_effective->>'productName'),
        category = v_effective->>'category'
    where workspace_id = v_batch.workspace_id
      and sabangnet_code = btrim(v_effective->>'sabangnetCode')
    returning id into strict v_product_id;
    insert into public.activity_logs (
      workspace_id, actor_user_id, actor_ref, action_type, entity_type,
      entity_id, changed_fields, correlation_id
    ) values (
      v_batch.workspace_id, v_actor, v_actor_ref, 'MASTER_PRODUCT_UPDATED', 'PRODUCT',
      v_product_id,
      jsonb_build_object('sourceBatchId', v_batch.id, 'fields', v_row->'changes'),
      v_correlation_id
    );
  end loop;

  for v_row in select value from jsonb_array_elements(v_preview->'rows')
    where value->>'kind' = 'SKU' and value->>'status' = 'NEW'
  loop
    select * into strict v_candidate from public.import_candidates where id = (v_row->>'candidateId')::uuid;
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    insert into public.skus (workspace_id, sku_code, model_name, color, status)
    values (
      v_batch.workspace_id,
      btrim(v_effective->>'skuCode'),
      btrim(v_effective->>'modelName'),
      v_effective->>'color',
      'ACTIVE'
    );
  end loop;

  for v_row in select value from jsonb_array_elements(v_preview->'rows')
    where value->>'kind' = 'SKU' and value->>'status' = 'UPDATE'
  loop
    select * into strict v_candidate from public.import_candidates where id = (v_row->>'candidateId')::uuid;
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    update public.skus
    set model_name = btrim(v_effective->>'modelName'),
        color = v_effective->>'color'
    where workspace_id = v_batch.workspace_id
      and sku_code = btrim(v_effective->>'skuCode')
    returning id into strict v_sku_id;
    insert into public.activity_logs (
      workspace_id, actor_user_id, actor_ref, action_type, entity_type,
      entity_id, changed_fields, correlation_id
    ) values (
      v_batch.workspace_id, v_actor, v_actor_ref, 'MASTER_SKU_UPDATED', 'SKU',
      v_sku_id,
      jsonb_build_object('sourceBatchId', v_batch.id, 'fields', v_row->'changes'),
      v_correlation_id
    );
  end loop;

  for v_row in select value from jsonb_array_elements(v_preview->'rows')
    where value->>'kind' = 'BOM_COMPONENT' and value->>'status' in ('NEW', 'UPDATE')
  loop
    select * into strict v_candidate from public.import_candidates where id = (v_row->>'candidateId')::uuid;
    v_effective := v_candidate.normalized_values || coalesce(v_candidate.reviewed_values, '{}'::jsonb);
    v_product_code := btrim(coalesce(v_effective->>'productCode', ''));
    v_product_source_row := null;
    if jsonb_typeof(v_effective->'productSourceRow') = 'number' then
      v_product_source_row := (v_effective->>'productSourceRow')::integer;
    end if;
    if v_product_source_row is not null then
      select reference.normalized_values || coalesce(reference.reviewed_values, '{}'::jsonb)
        into v_reference_effective
      from public.import_candidates reference
      where reference.workspace_id = v_batch.workspace_id
        and reference.import_batch_id = v_batch.id
        and reference.validation_revision = v_batch.validation_revision
        and reference.kind = 'PRODUCT'
        and reference.source_row = v_product_source_row
      order by reference.candidate_ordinal
      limit 1;
      if found then
        if jsonb_typeof(v_reference_effective->'variantOfSourceRow') = 'number' then
          select canonical.normalized_values || coalesce(canonical.reviewed_values, '{}'::jsonb)
            into v_reference_effective
          from public.import_candidates canonical
          where canonical.workspace_id = v_batch.workspace_id
            and canonical.import_batch_id = v_batch.id
            and canonical.validation_revision = v_batch.validation_revision
            and canonical.kind = 'PRODUCT'
            and canonical.source_row = (v_reference_effective->>'variantOfSourceRow')::integer
          order by canonical.candidate_ordinal
          limit 1;
        end if;
        v_product_code := btrim(coalesce(v_reference_effective->>'sabangnetCode', v_product_code));
      end if;
    end if;
    v_sku_code := btrim(v_effective->>'skuCode');
    v_quantity := (v_effective->>'quantity')::integer;
    select id into strict v_product_id from public.products
      where workspace_id = v_batch.workspace_id and sabangnet_code = v_product_code;
    select id into strict v_sku_id from public.skus
      where workspace_id = v_batch.workspace_id and sku_code = v_sku_code;

    if v_row->>'status' = 'NEW' then
      insert into public.product_components (workspace_id, product_id, sku_id, quantity)
      values (v_batch.workspace_id, v_product_id, v_sku_id, v_quantity);
    else
      update public.product_components
      set quantity = v_quantity
      where workspace_id = v_batch.workspace_id
        and product_id = v_product_id
        and sku_id = v_sku_id
      returning id into strict v_component_id;
      insert into public.activity_logs (
        workspace_id, actor_user_id, actor_ref, action_type, entity_type,
        entity_id, changed_fields, correlation_id
      ) values (
        v_batch.workspace_id, v_actor, v_actor_ref, 'MASTER_BOM_UPDATED', 'PRODUCT_COMPONENT',
        v_component_id,
        jsonb_build_object('sourceBatchId', v_batch.id, 'fields', v_row->'changes'),
        v_correlation_id
      );
    end if;
  end loop;

  v_product_created := (v_preview->>'productNew')::integer;
  v_product_updated := (v_preview->>'productUpdate')::integer;
  v_sku_created := (v_preview->>'skuNew')::integer;
  v_sku_updated := (v_preview->>'skuUpdate')::integer;
  v_bom_created := (v_preview->>'bomNew')::integer;
  v_bom_updated := (v_preview->>'bomUpdate')::integer;
  v_skipped := (v_preview->>'productSkipped')::integer
    + (v_preview->>'skuSkipped')::integer
    + (v_preview->>'bomSkipped')::integer;
  v_remaining := v_skipped;
  v_final_status := case when v_remaining = 0 then 'APPLIED' else 'PARTIALLY_APPLIED' end;

  update public.import_batches
  set status = v_final_status,
      applied_count = v_product_created + v_product_updated
        + v_sku_created + v_sku_updated
        + v_bom_created + v_bom_updated,
      failed_count = 0,
      remaining_count = v_remaining,
      applied_at = now()
  where id = v_batch.id;

  insert into public.activity_logs (
    workspace_id, actor_user_id, actor_ref, action_type, entity_type,
    entity_id, changed_fields, correlation_id
  ) values (
    v_batch.workspace_id, v_actor, v_actor_ref, 'IMPORT_APPLIED', 'IMPORT_BATCH',
    v_batch.id,
    jsonb_build_object(
      'productCreated', v_product_created,
      'productUpdated', v_product_updated,
      'productUnchanged', (v_preview->>'productUnchanged')::integer,
      'skuCreated', v_sku_created,
      'skuUpdated', v_sku_updated,
      'skuUnchanged', (v_preview->>'skuUnchanged')::integer,
      'bomCreated', v_bom_created,
      'bomUpdated', v_bom_updated,
      'bomUnchanged', (v_preview->>'bomUnchanged')::integer,
      'skipped', v_skipped,
      'finalBatchStatus', v_final_status
    ),
    v_correlation_id
  );

  return v_preview || jsonb_build_object(
    'finalBatchStatus', v_final_status,
    'appliedCount', v_product_created + v_product_updated
      + v_sku_created + v_sku_updated
      + v_bom_created + v_bom_updated,
    'remainingCount', v_remaining
  );
end;
$$;

create or replace function public.apply_master_import_batch(p_batch_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.apply_master_import_batch(p_batch_id);
$$;

revoke all on function seller_audit_private.preview_master_import_apply(uuid)
  from public, anon, authenticated;
revoke all on function seller_audit_private.apply_master_import_batch(uuid)
  from public, anon, authenticated;
grant execute on function seller_audit_private.preview_master_import_apply(uuid)
  to authenticated, service_role;
grant execute on function seller_audit_private.apply_master_import_batch(uuid)
  to authenticated, service_role;

revoke all on function public.preview_master_import_apply(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_master_import_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.preview_master_import_apply(uuid)
  to authenticated;
grant execute on function public.apply_master_import_batch(uuid)
  to authenticated;

comment on function public.preview_master_import_apply(uuid) is
  'Read-only Pilot Apply v2 preview. ACTIVE ADMIN and EDITOR only; classifies safe field changes as UPDATE.';
comment on function public.apply_master_import_batch(uuid) is
  'Atomic create and safe-update Pilot Apply v2. ACTIVE ADMIN only; no deletes or business-key renames.';

commit;
