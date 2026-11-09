CREATE TABLE IF NOT EXISTS seller_audit_local.product_manual_prices (
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  cost numeric(14,2) CHECK(cost>=0),
  normal numeric(14,2) CHECK(normal>=0),
  regular numeric(14,2) CHECK(regular>=0),
  basic numeric(14,2) CHECK(basic>=0),
  medium numeric(14,2) CHECK(medium>=0),
  large numeric(14,2) CHECK(large>=0),
  live numeric(14,2) CHECK(live>=0),
  "group" numeric(14,2) CHECK("group">=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,product_id),
  FOREIGN KEY(workspace_id,product_id) REFERENCES seller_audit_local.products(workspace_id,id) ON DELETE RESTRICT
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='selleraudit_app') THEN
  GRANT SELECT,INSERT,UPDATE ON seller_audit_local.product_manual_prices TO selleraudit_app;
  GRANT DELETE ON seller_audit_local.product_components TO selleraudit_app;
 END IF;
END $$;
