-- 006_drivers.sql - approved drivers (non-students) who apply and are vetted by an admin

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'driver', 'admin'));

CREATE TABLE driver_applications (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
  licence_number text NOT NULL CHECK (char_length(licence_number) BETWEEN 4 AND 30),
  id_number      text NOT NULL CHECK (char_length(id_number) BETWEEN 5 AND 20),
  about          text CHECK (char_length(about) <= 1000),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes    text CHECK (char_length(admin_notes) <= 2000),
  reviewed_by    uuid REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_applications_status_idx ON driver_applications (status, created_at DESC);
CREATE TRIGGER driver_applications_set_updated_at BEFORE UPDATE ON driver_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
