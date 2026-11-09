-- Local identity; the 7A placeholder contains no real accounts.
ALTER TABLE seller_audit_local.app_users
  ADD COLUMN email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  ADD COLUMN display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  ADD COLUMN password_hash text,
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','DISABLED')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN password_changed_at timestamptz,
  ADD CONSTRAINT app_users_email_key UNIQUE (email),
  ADD CONSTRAINT app_users_active_password_check CHECK (status <> 'ACTIVE' OR password_hash IS NOT NULL);

ALTER TABLE seller_audit_local.foundation ADD COLUMN initialized_at timestamptz;

CREATE TABLE seller_audit_local.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES seller_audit_local.app_users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX user_sessions_user_id_idx ON seller_audit_local.user_sessions(user_id);

CREATE TABLE seller_audit_local.setup_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES seller_audit_local.app_users(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES seller_audit_local.workspaces(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX setup_tokens_user_id_idx ON seller_audit_local.setup_tokens(user_id);
