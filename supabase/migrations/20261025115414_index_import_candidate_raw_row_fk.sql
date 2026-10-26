create index import_candidates_raw_row_fk_idx
  on public.import_candidates(workspace_id, import_batch_id, raw_import_row_id);
