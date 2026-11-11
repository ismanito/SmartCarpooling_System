-- 010_driver_verification.sql - checked, approved drivers only. Student, staff and external drivers each get the checks that fit.

ALTER TABLE users ADD COLUMN admin_level text NOT NULL DEFAULT 'admin' CHECK (admin_level IN ('admin', 'senior_admin'));
ALTER TABLE users ADD COLUMN allow_external_drivers boolean NOT NULL DEFAULT true;

-- One row per person who has started to become a driver.
CREATE TABLE driver_verifications (
  driver_id          uuid PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  driver_type        text NOT NULL CHECK (driver_type IN ('student', 'staff', 'external')),
  status             text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'pending_review', 'approved', 'rejected', 'expired', 'suspended')),
  consent_at         timestamptz,
  public_photo_consent boolean NOT NULL DEFAULT false,
  qr_token           uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- identity. Only the last four digits of a national ID are ever stored.
  id_expiry          date,                       -- student or staff ID
  national_id_last4  text CHECK (national_id_last4 ~ '^[0-9A-Za-z]{4}$'),
  -- licence
  licence_number     text,
  licence_holder_name text,
  licence_expiry     date,
  licence_held_since date,
  -- insurance
  insurance_provider text,
  insurance_policy_no text,
  insurance_expiry   date,
  insurance_covers_passengers boolean,
  -- vehicle
  vehicle_id         uuid REFERENCES vehicles (vehicle_id) ON DELETE SET NULL,
  owner_relationship text CHECK (owner_relationship IN ('self', 'parent', 'other')),
  -- external drivers only
  good_conduct_issued date,
  psv_badge_no       text,
  psv_badge_expiry   date,
  inspection_date    date,
  inspected_by       text,
  -- in-person check at campus security
  in_person_checked_at date,
  in_person_officer  text,
  -- review
  submitted_at       timestamptz,
  reviewed_by        uuid REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  approved_at        timestamptz,
  rejection_reason   text,
  suspended_reason   text,
  suspended_at       timestamptz,
  -- staying verified
  next_recheck_at    timestamptz,
  recheck_state      text NOT NULL DEFAULT 'none' CHECK (recheck_state IN ('none', 'due', 'submitted')),
  recheck_grace_until timestamptz,
  reminders_sent     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_verifications_status_idx ON driver_verifications (status, submitted_at);
CREATE TRIGGER driver_verifications_set_updated_at BEFORE UPDATE ON driver_verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Files live in private storage. Even after a file is deleted its hash stays, so a reused document can still be spotted.
CREATE TABLE verification_documents (
  doc_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN ('student_id', 'staff_id', 'national_id_front', 'national_id_back', 'good_conduct', 'psv_badge',
                 'inspection_report', 'licence_front', 'licence_back', 'selfie', 'selfie_head_turn', 'logbook', 'owner_letter', 'insurance',
                 'car_front_plate', 'car_back', 'car_interior', 'selfie_recheck')),
  storage_key  text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   int NOT NULL CHECK (size_bytes > 0),
  sha256       char(64) NOT NULL,
  captured_live boolean NOT NULL DEFAULT false,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_reason text
);
CREATE UNIQUE INDEX verification_documents_active_idx ON verification_documents (driver_id, doc_type) WHERE deleted_at IS NULL AND doc_type <> 'selfie_recheck';
CREATE INDEX verification_documents_hash_idx ON verification_documents (sha256);

-- Every checklist decision an admin makes.
CREATE TABLE verification_checks (
  check_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES users (user_id) ON DELETE SET NULL,
  item        text NOT NULL,
  result      text NOT NULL CHECK (result IN ('pass', 'fail')),
  note        text CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_checks_driver_idx ON verification_checks (driver_id, item, created_at DESC);

-- The live selfie asked for when a driver goes online (a random share of the time). An admin reviews flagged ones.
CREATE TABLE selfie_checks (
  check_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  doc_id     uuid REFERENCES verification_documents (doc_id) ON DELETE SET NULL,
  status     text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'flagged', 'cleared')),
  used_at    timestamptz,
  reviewed_by uuid REFERENCES users (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A rider confirms the driver and car before the ride starts.
ALTER TABLE trip_requests ADD COLUMN rider_confirmed_driver_at timestamptz;
ALTER TABLE incident_reports DROP CONSTRAINT incident_reports_category_check;
ALTER TABLE incident_reports ADD CONSTRAINT incident_reports_category_check
  CHECK (category IN ('unsafe_driving', 'no_show', 'harassment', 'payment_demand', 'driver_mismatch', 'other'));

-- Earlier driver accounts must now go through verification. Their full ID numbers are cut to the last four digits.
INSERT INTO driver_verifications (driver_id, driver_type) SELECT user_id, 'external' FROM users WHERE role = 'driver' ON CONFLICT DO NOTHING;
UPDATE driver_applications SET id_number = '****' || right(id_number, 4) WHERE id_number NOT LIKE '****%';

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('external_drivers_enabled', 'false'),
  ('min_licence_years', '1'),
  ('expiry_warning_days', '14'),
  ('recheck_months', '6'),
  ('doc_retention_days', '30'),
  ('auto_suspend_rating', '3.5'),
  ('auto_suspend_min_ratings', '5'),
  ('auto_suspend_incidents', '2'),
  ('random_selfie_check_percent', '10')
ON CONFLICT (setting_key) DO NOTHING;
