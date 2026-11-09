-- Allow products to be recorded before a Sabangnet code is assigned.
-- The existing unique constraint still prevents duplicate non-null codes.
ALTER TABLE seller_audit_local.products ALTER COLUMN sabangnet_code DROP NOT NULL;
