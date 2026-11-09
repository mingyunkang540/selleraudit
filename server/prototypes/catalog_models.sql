-- Prototype only: not in the migration runner. Existing import/Apply
-- functions do not yet write this catalog and it must not be used for data.
CREATE TABLE seller_audit_local.unlisted_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES seller_audit_local.workspaces(id) ON DELETE RESTRICT,
  source_file_id uuid NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unlisted_bundles_source_fkey FOREIGN KEY (workspace_id,source_file_id)
    REFERENCES seller_audit_local.import_source_files(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT unlisted_bundles_workspace_id_id_key UNIQUE (workspace_id,id),
  CONSTRAINT unlisted_bundles_source_row_key UNIQUE (workspace_id,source_file_id,source_row)
);

CREATE TABLE seller_audit_local.unlisted_bundle_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  CONSTRAINT unlisted_components_bundle_fkey FOREIGN KEY (workspace_id,bundle_id)
    REFERENCES seller_audit_local.unlisted_bundles(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT unlisted_components_sku_fkey FOREIGN KEY (workspace_id,sku_id)
    REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT unlisted_components_unique_key UNIQUE (workspace_id,bundle_id,sku_id)
);

CREATE TABLE seller_audit_local.market_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES seller_audit_local.workspaces(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_collections_product_fkey FOREIGN KEY (workspace_id,product_id)
    REFERENCES seller_audit_local.products(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT market_collections_product_key UNIQUE (workspace_id,product_id),
  CONSTRAINT market_collections_workspace_id_id_key UNIQUE (workspace_id,id)
);

CREATE TABLE seller_audit_local.market_collection_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  source_file_id uuid NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  option_name text NOT NULL CHECK (btrim(option_name) <> ''),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_options_collection_fkey FOREIGN KEY (workspace_id,collection_id)
    REFERENCES seller_audit_local.market_collections(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT collection_options_sku_fkey FOREIGN KEY (workspace_id,sku_id)
    REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT collection_options_source_fkey FOREIGN KEY (workspace_id,source_file_id)
    REFERENCES seller_audit_local.import_source_files(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT collection_options_source_row_key UNIQUE (workspace_id,source_file_id,source_row),
  CONSTRAINT collection_options_collection_sku_key UNIQUE (workspace_id,collection_id,sku_id)
);

CREATE INDEX unlisted_components_sku_idx ON seller_audit_local.unlisted_bundle_components(workspace_id,sku_id);
CREATE INDEX collection_options_sku_idx ON seller_audit_local.market_collection_options(workspace_id,sku_id);

-- Preserve the marketplace SKU as a single SKU and separately describe its
-- physical contents. Only trusted import logic may populate these rows.
CREATE TABLE seller_audit_local.sku_assembly_components (
  workspace_id uuid NOT NULL,
  assembly_sku_id uuid NOT NULL,
  component_sku_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  CONSTRAINT assembly_not_self CHECK (assembly_sku_id <> component_sku_id),
  CONSTRAINT assembly_sku_fkey FOREIGN KEY (workspace_id,assembly_sku_id)
    REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT assembly_component_fkey FOREIGN KEY (workspace_id,component_sku_id)
    REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT,
  PRIMARY KEY (workspace_id,assembly_sku_id,component_sku_id)
);
CREATE INDEX assembly_component_idx ON seller_audit_local.sku_assembly_components(workspace_id,component_sku_id);
CREATE FUNCTION seller_audit_local.check_one_level_sku_assembly() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.workspace_id::text, 1497));
  IF EXISTS (SELECT 1 FROM seller_audit_local.sku_assembly_components c WHERE c.workspace_id=NEW.workspace_id AND c.assembly_sku_id=NEW.component_sku_id)
     OR EXISTS (SELECT 1 FROM seller_audit_local.sku_assembly_components c WHERE c.workspace_id=NEW.workspace_id AND c.component_sku_id=NEW.assembly_sku_id) THEN
    RAISE EXCEPTION 'Nested SKU assemblies are not supported.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sku_assembly_one_level BEFORE INSERT OR UPDATE ON seller_audit_local.sku_assembly_components
  FOR EACH ROW EXECUTE FUNCTION seller_audit_local.check_one_level_sku_assembly();

-- A source channel is not a marketplace listing ID. Keep it as source data,
-- and keep its BOM distinct from the parent product's default composition.
CREATE TABLE seller_audit_local.product_channel_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  source_file_id uuid NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  source_channel text NOT NULL CHECK (btrim(source_channel) <> ''),
  CONSTRAINT channel_variant_product_fkey FOREIGN KEY (workspace_id,product_id)
    REFERENCES seller_audit_local.products(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT channel_variant_source_fkey FOREIGN KEY (workspace_id,source_file_id)
    REFERENCES seller_audit_local.import_source_files(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT channel_variant_workspace_id_key UNIQUE (workspace_id,id),
  CONSTRAINT channel_variant_product_key UNIQUE (workspace_id,product_id,source_channel),
  CONSTRAINT channel_variant_source_key UNIQUE (workspace_id,source_file_id,source_row)
);
CREATE TABLE seller_audit_local.product_channel_variant_components (
  workspace_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  CONSTRAINT channel_variant_component_parent_fkey FOREIGN KEY (workspace_id,variant_id)
    REFERENCES seller_audit_local.product_channel_variants(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT channel_variant_component_sku_fkey FOREIGN KEY (workspace_id,sku_id)
    REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT,
  PRIMARY KEY (workspace_id,variant_id,sku_id)
);
CREATE INDEX channel_variant_component_sku_idx ON seller_audit_local.product_channel_variant_components(workspace_id,sku_id);
