-- Infrastructure marker only. Business schema and authentication require later phases.
CREATE TABLE seller_audit_local.foundation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO seller_audit_local.foundation (singleton) VALUES (true);
