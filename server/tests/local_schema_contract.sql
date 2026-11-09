-- Synthetic fixtures in an isolated database. Rolled back even when successful.
BEGIN;
DO $$
DECLARE
  wa uuid := gen_random_uuid(); wb uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  batch uuid := gen_random_uuid(); raw uuid := gen_random_uuid(); candidate uuid := gen_random_uuid();
  test_actor uuid := gen_random_uuid();
BEGIN
  INSERT INTO seller_audit_local.app_users(id) VALUES (test_actor);
  INSERT INTO seller_audit_local.workspaces(id,name) VALUES (wa,'A'), (wb,'B');
  INSERT INTO seller_audit_local.workspace_members(workspace_id,user_id) VALUES (wa,test_actor);
  IF NOT EXISTS (SELECT 1 FROM seller_audit_local.workspace_members WHERE workspace_id=wa AND user_id=test_actor AND role='VIEWER' AND status='INVITED') THEN
    RAISE EXCEPTION 'member defaults incorrect';
  END IF;
  INSERT INTO seller_audit_local.products(id,workspace_id,sabangnet_code,product_name,product_type) VALUES (p,wa,'P1','Product','SINGLE');
  INSERT INTO seller_audit_local.skus(id,workspace_id,sku_code,model_name) VALUES (s,wb,'S1','SKU');
  BEGIN
    INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES (wa,p,s,1);
    RAISE EXCEPTION 'cross-workspace SKU was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,product_type) VALUES (wa,'P1','Duplicate','SINGLE');
    RAISE EXCEPTION 'duplicate product key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO seller_audit_local.import_batches(id,workspace_id,source_type,source_scope_key,source_filename,source_file_hash,parser_version)
  VALUES (batch,wa,'MASTER_WORKBOOK','WORKBOOK','fixture.xlsx',repeat('a',64),'test');
  INSERT INTO seller_audit_local.raw_import_rows(id,workspace_id,import_batch_id,source_sheet,original_row_number,raw_cells)
  VALUES (raw,wa,batch,'Sheet',1,'[]'::jsonb);
  INSERT INTO seller_audit_local.import_candidates(id,workspace_id,import_batch_id,raw_import_row_id,validation_revision,candidate_ordinal,kind,source_sheet,source_row,source_field_map,normalized_values,candidate_status)
  VALUES (candidate,wa,batch,raw,1,1,'PRODUCT','Sheet',1,'{}'::jsonb,'{}'::jsonb,'VALID');
  BEGIN
    UPDATE seller_audit_local.import_candidates SET normalized_values='{"changed":true}'::jsonb WHERE id=candidate;
    RAISE EXCEPTION 'normalized candidate was mutable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$$;
ROLLBACK;
