-- 001_init.sql – users, vehicles, system settings, tamper-evident audit log
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  user_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid     text NOT NULL UNIQUE,
  full_name        text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  university_email text NOT NULL UNIQUE CHECK (university_email = lower(university_email)),
  phone_number     text NOT NULL,
  faculty          text NOT NULL,
  role             text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_verified      boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  avg_rating       numeric(2,1) NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- vehicles
CREATE TABLE vehicles (
  vehicle_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  make_model    text NOT NULL CHECK (char_length(make_model) BETWEEN 2 AND 80),
  plate_number  text NOT NULL UNIQUE CHECK (plate_number ~ '^[A-Z0-9]{3,10}$'),
  colour        text NOT NULL CHECK (char_length(colour) BETWEEN 2 AND 30),
  seat_capacity int  NOT NULL CHECK (seat_capacity BETWEEN 1 AND 7),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_owner_idx ON vehicles (owner_id);

-- ---------------------------------------------------------------- system settings
CREATE TABLE system_settings (
  setting_key   text PRIMARY KEY,
  setting_value text NOT NULL,
  updated_by    uuid REFERENCES users (user_id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('allowed_email_domains', 'usiu.ac.ke'),  -- mirrored from ALLOWED_EMAIL_DOMAINS by `npm run seed`
  ('search_radius_km',      '2'),
  ('time_window_min',       '15'),
  ('max_detour_km',         '3'),
  ('w_overlap',             '0.5'),
  ('w_time',                '0.3'),
  ('w_detour',              '0.2'),
  ('fuel_rate_kes_per_km',  '24')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------- audit log
-- Append-only hash chain: entry_hash = SHA-256(prev_hash || canonical JSON of the entry).
-- user_id deliberately has no FK so that deleting a user can never rewrite history.
CREATE TABLE audit_log (
  audit_id    bigserial PRIMARY KEY,
  user_id     uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  ip_address  inet,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL,
  prev_hash   char(64) NOT NULL,
  entry_hash  char(64) NOT NULL UNIQUE
);
CREATE INDEX audit_log_user_idx   ON audit_log (user_id, created_at);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

CREATE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- ---------------------------------------------------------------- updated_at helper
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
