BEGIN;
DO $$
DECLARE uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO seller_audit_local.app_users (id,email,display_name) VALUES (uid,'user@example.com','Example');
  BEGIN
    INSERT INTO seller_audit_local.app_users (email,display_name) VALUES ('USER@example.com','Bad email');
    RAISE EXCEPTION 'non-normalized email accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO seller_audit_local.app_users (email,display_name) VALUES ('user@example.com','Duplicate');
    RAISE EXCEPTION 'duplicate email accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE seller_audit_local.app_users SET status='ACTIVE' WHERE id=uid;
    RAISE EXCEPTION 'active user without password accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO seller_audit_local.user_sessions(user_id,token_hash,csrf_hash,expires_at)
    VALUES (uid,'raw-token',repeat('a',64),now()+interval '1 hour');
    RAISE EXCEPTION 'unhashed session token accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;
ROLLBACK;
