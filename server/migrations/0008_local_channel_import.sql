-- Permit the existing local application role to import channel listings.
-- No DELETE privilege or superuser capability is granted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'selleraudit_app') THEN
    GRANT SELECT, INSERT, UPDATE ON seller_audit_local.channels,
      seller_audit_local.channel_listings TO selleraudit_app;
  END IF;
END;
$$;
