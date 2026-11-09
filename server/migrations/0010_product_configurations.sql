-- Product configurations preserve one marketplace code while giving each
-- commercial option its own composition and independently verified prices.
CREATE TABLE IF NOT EXISTS seller_audit_local.product_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  normal_price numeric(14,2) CHECK (normal_price >= 0),
  regular_price numeric(14,2) CHECK (regular_price >= 0),
  basic_price numeric(14,2) CHECK (basic_price >= 0),
  medium_price numeric(14,2) CHECK (medium_price >= 0),
  large_price numeric(14,2) CHECK (large_price >= 0),
  live_price numeric(14,2) CHECK (live_price >= 0),
  group_price numeric(14,2) CHECK (group_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,product_id,name),
  FOREIGN KEY(workspace_id,product_id) REFERENCES seller_audit_local.products(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS seller_audit_local.product_configuration_components (
  workspace_id uuid NOT NULL,
  configuration_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0),
  PRIMARY KEY(workspace_id,configuration_id,sku_id),
  FOREIGN KEY(workspace_id,configuration_id) REFERENCES seller_audit_local.product_configurations(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,sku_id) REFERENCES seller_audit_local.skus(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS seller_audit_local.offer_configurations (
  workspace_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  configuration_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,offer_id),
  FOREIGN KEY(workspace_id,offer_id) REFERENCES seller_audit_local.channel_offers(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,configuration_id) REFERENCES seller_audit_local.product_configurations(workspace_id,id) ON DELETE RESTRICT
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='selleraudit_app') THEN
  GRANT SELECT,INSERT,UPDATE ON seller_audit_local.product_configurations,seller_audit_local.product_configuration_components,seller_audit_local.offer_configurations TO selleraudit_app;
  GRANT DELETE ON seller_audit_local.product_configuration_components,seller_audit_local.offer_configurations TO selleraudit_app;
 END IF;
END $$;
