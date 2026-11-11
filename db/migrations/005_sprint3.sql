-- 005_sprint3.sql - notifications, incident reports, rating tags, fare settings

CREATE TABLE notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  type       text NOT NULL,
  message    text NOT NULL,
  link       text,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

-- A "ride" in the app is a confirmed booking, so reports point at the booking.
CREATE TABLE incident_reports (
  report_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  booking_id       uuid NOT NULL REFERENCES bookings (booking_id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('unsafe_driving', 'no_show', 'harassment', 'payment_demand', 'other')),
  description      text NOT NULL CHECK (char_length(description) BETWEEN 5 AND 2000),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed')),
  decision         text CHECK (decision IN ('dismissed', 'warning', 'suspended')),
  admin_notes      text CHECK (char_length(admin_notes) <= 2000),
  reviewed_by      uuid REFERENCES users (user_id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  CHECK (reporter_id <> reported_user_id)
);
CREATE INDEX incident_reports_status_idx ON incident_reports (status, created_at DESC);
CREATE INDEX incident_reports_reported_idx ON incident_reports (reported_user_id);

ALTER TABLE ratings ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

-- The driver confirms each rider's share (cash or M-Pesa happen outside the app).
ALTER TABLE payment_shares ADD COLUMN settled_by uuid REFERENCES users (user_id) ON DELETE SET NULL;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('fare_rounding_kes', '10'),
  ('commission_percent', '0')
ON CONFLICT (setting_key) DO NOTHING;
