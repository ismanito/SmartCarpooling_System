-- 008_dispatch.sql - Ride Now / Book: the system picks the driver and pools riders by zone.
-- The old trip-posting tables (ride_offers, ride_requests, bookings) are kept untouched.

-- ---------------------------------------------------------------- zones
CREATE TABLE zones (
  zone_id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 60),
  polygon    geography(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_polygon_gix ON zones USING gist (polygon);

-- Two zones are neighbours when a ride to one can drop someone off in the other on the way. Stored both ways.
CREATE TABLE zone_neighbours (
  zone_id      int NOT NULL REFERENCES zones (zone_id) ON DELETE CASCADE,
  neighbour_id int NOT NULL REFERENCES zones (zone_id) ON DELETE CASCADE,
  PRIMARY KEY (zone_id, neighbour_id),
  CHECK (zone_id <> neighbour_id)
);

-- Rough boxes around each area (west, south, east, north). The admin refines them in the zone editor.
-- Where boxes overlap, the smallest one wins when a point is tagged.
INSERT INTO zones (name, polygon) VALUES
  ('USIU Campus',         ST_MakeEnvelope(36.872, -1.224, 36.886, -1.214, 4326)::geography),
  ('Thika Road Mall',     ST_MakeEnvelope(36.884, -1.2225, 36.893, -1.2165, 4326)::geography),
  ('Roysambu',            ST_MakeEnvelope(36.880, -1.228, 36.900, -1.208, 4326)::geography),
  ('Kasarani',            ST_MakeEnvelope(36.900, -1.235, 36.925, -1.208, 4326)::geography),
  ('Githurai',            ST_MakeEnvelope(36.905, -1.215, 36.930, -1.190, 4326)::geography),
  ('Kahawa',              ST_MakeEnvelope(36.895, -1.200, 36.945, -1.178, 4326)::geography),
  ('Ruaraka',             ST_MakeEnvelope(36.865, -1.255, 36.885, -1.228, 4326)::geography),
  ('Ruaka',               ST_MakeEnvelope(36.755, -1.225, 36.795, -1.190, 4326)::geography),
  ('Runda and Gigiri',    ST_MakeEnvelope(36.800, -1.250, 36.835, -1.205, 4326)::geography),
  ('Muthaiga',            ST_MakeEnvelope(36.825, -1.260, 36.845, -1.240, 4326)::geography),
  ('Westlands',           ST_MakeEnvelope(36.795, -1.278, 36.830, -1.250, 4326)::geography),
  ('Nairobi CBD',         ST_MakeEnvelope(36.805, -1.300, 36.835, -1.278, 4326)::geography),
  ('Kilimani and Lavington', ST_MakeEnvelope(36.755, -1.305, 36.795, -1.265, 4326)::geography),
  ('Eastleigh',           ST_MakeEnvelope(36.835, -1.290, 36.870, -1.262, 4326)::geography),
  ('South B',             ST_MakeEnvelope(36.820, -1.320, 36.860, -1.295, 4326)::geography),
  ('Embakasi',            ST_MakeEnvelope(36.880, -1.340, 36.920, -1.300, 4326)::geography);

WITH pairs(a, b) AS (VALUES
  ('USIU Campus', 'Thika Road Mall'), ('USIU Campus', 'Roysambu'), ('USIU Campus', 'Ruaraka'),
  ('Thika Road Mall', 'Roysambu'), ('Thika Road Mall', 'Kasarani'), ('Roysambu', 'Kasarani'), ('Roysambu', 'Ruaraka'),
  ('Kasarani', 'Githurai'), ('Githurai', 'Kahawa'), ('Roysambu', 'Kahawa'),
  ('Ruaraka', 'Muthaiga'), ('Ruaraka', 'Eastleigh'), ('Muthaiga', 'Runda and Gigiri'), ('Muthaiga', 'Westlands'),
  ('Runda and Gigiri', 'Westlands'), ('Runda and Gigiri', 'Ruaka'), ('Westlands', 'Nairobi CBD'),
  ('Westlands', 'Kilimani and Lavington'), ('Nairobi CBD', 'Kilimani and Lavington'), ('Nairobi CBD', 'Eastleigh'),
  ('Nairobi CBD', 'South B'), ('South B', 'Embakasi'), ('Eastleigh', 'South B')
)
INSERT INTO zone_neighbours (zone_id, neighbour_id)
SELECT za.zone_id, zb.zone_id FROM pairs p JOIN zones za ON za.name = p.a JOIN zones zb ON zb.name = p.b
UNION
SELECT zb.zone_id, za.zone_id FROM pairs p JOIN zones za ON za.name = p.a JOIN zones zb ON zb.name = p.b;

-- ---------------------------------------------------------------- drivers online
-- Only the current position is kept while the driver is online. There is no location history.
CREATE TABLE driver_status (
  driver_id       uuid PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  vehicle_id      uuid REFERENCES vehicles (vehicle_id) ON DELETE SET NULL,
  is_online       boolean NOT NULL DEFAULT false,
  current_location geography(Point, 4326),
  heading         real CHECK (heading BETWEEN 0 AND 360),
  seats_free      int NOT NULL DEFAULT 0 CHECK (seats_free >= 0),
  active_ride_id  uuid,
  online_since    timestamptz,
  last_seen_at    timestamptz
);
CREATE INDEX driver_status_online_gix ON driver_status USING gist (current_location) WHERE is_online;

-- ---------------------------------------------------------------- rides and stops
CREATE TABLE rides (
  ride_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  vehicle_id     uuid REFERENCES vehicles (vehicle_id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'heading_to_pickup' CHECK (status IN ('heading_to_pickup', 'in_progress', 'completed', 'cancelled')),
  total_km       numeric(7,2),
  total_cost_kes int,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rides_driver_idx ON rides (driver_id, created_at DESC);
ALTER TABLE driver_status ADD CONSTRAINT driver_status_ride_fk FOREIGN KEY (active_ride_id) REFERENCES rides (ride_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- ride requests (Ride Now and Book)
CREATE TABLE trip_requests (
  request_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id        uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  series_id       uuid,            -- repeating bookings share one series id
  group_id        uuid,            -- scheduled bookings pooled before dispatch share one group id
  type            text NOT NULL CHECK (type IN ('now', 'scheduled')),
  pickup_point    geography(Point, 4326) NOT NULL,
  pickup_label    text NOT NULL,
  pickup_zone     int REFERENCES zones (zone_id) ON DELETE SET NULL,
  dropoff_point   geography(Point, 4326) NOT NULL,
  dropoff_label   text NOT NULL,
  dropoff_zone    int REFERENCES zones (zone_id) ON DELETE SET NULL,
  scheduled_for   timestamptz,
  repeat_days     text[],
  seats           int NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 2),
  status          text NOT NULL DEFAULT 'searching' CHECK (status IN
                    ('scheduled', 'searching', 'offered', 'assigned', 'picked_up', 'completed', 'cancelled', 'no_driver')),
  route_km        numeric(7,2) NOT NULL,
  est_share_kes   int NOT NULL,   -- if travelling alone
  est_pooled_kes  int NOT NULL,   -- if pooled with two others
  ride_id         uuid REFERENCES rides (ride_id) ON DELETE SET NULL,
  driver_id       uuid REFERENCES users (user_id) ON DELETE SET NULL,
  cancel_reason   text,
  assigned_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (type = 'now' OR scheduled_for IS NOT NULL)
);
CREATE INDEX trip_requests_rider_idx ON trip_requests (rider_id, created_at DESC);
CREATE INDEX trip_requests_open_idx ON trip_requests (status, scheduled_for) WHERE status IN ('scheduled', 'searching', 'offered');
CREATE INDEX trip_requests_ride_idx ON trip_requests (ride_id);

-- Every driver a request was offered to, and what they did. This is the evidence for complaints.
CREATE TABLE dispatch_offers (
  offer_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES trip_requests (request_id) ON DELETE CASCADE,
  driver_id      uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  response       text CHECK (response IN ('accepted', 'declined', 'expired')),
  responded_at   timestamptz,
  pickup_eta_min real,
  extra_minutes  real,
  score          real,
  pooled         boolean NOT NULL DEFAULT false
);
CREATE INDEX dispatch_offers_request_idx ON dispatch_offers (request_id, sent_at);
CREATE INDEX dispatch_offers_driver_idx ON dispatch_offers (driver_id, sent_at DESC);
CREATE INDEX dispatch_offers_pending_idx ON dispatch_offers (expires_at) WHERE response IS NULL;

CREATE TABLE ride_stops (
  stop_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides (ride_id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES trip_requests (request_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('pickup', 'dropoff')),
  point       geography(Point, 4326) NOT NULL,
  label       text NOT NULL,
  sequence    int NOT NULL,
  eta         timestamptz,
  arrived_at  timestamptz,
  done_at     timestamptz,
  no_show     boolean NOT NULL DEFAULT false
);
CREATE INDEX ride_stops_ride_idx ON ride_stops (ride_id, sequence);

-- ---------------------------------------------------------------- fare shares (by leg, no commission)
CREATE TABLE ride_shares (
  share_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides (ride_id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES trip_requests (request_id) ON DELETE CASCADE,
  rider_id    uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  amount_kes  int NOT NULL CHECK (amount_kes >= 0),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  method      text CHECK (method IN ('mpesa', 'cash')),
  paid_at     timestamptz,
  settled_by  uuid REFERENCES users (user_id) ON DELETE SET NULL,
  UNIQUE (ride_id, request_id)
);
CREATE INDEX ride_shares_rider_idx ON ride_shares (rider_id, status);

-- ---------------------------------------------------------------- ratings and reports can point at a ride
ALTER TABLE ratings ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE ratings ADD COLUMN ride_id uuid REFERENCES rides (ride_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX ratings_ride_pair_idx ON ratings (ride_id, rater_id, ratee_id) WHERE ride_id IS NOT NULL;

ALTER TABLE incident_reports ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE incident_reports ADD COLUMN ride_id uuid REFERENCES rides (ride_id) ON DELETE CASCADE;
ALTER TABLE incident_reports ADD CONSTRAINT incident_reports_target_check CHECK (booking_id IS NOT NULL OR ride_id IS NOT NULL);

CREATE TRIGGER trip_requests_set_updated_at BEFORE UPDATE ON trip_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- settings
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('dispatch_radius_km', '3'),
  ('offer_timeout_s', '20'),
  ('max_offers_per_request', '5'),
  ('max_riders_per_car', '3'),
  ('max_extra_minutes_per_rider', '8'),
  ('scheduled_dispatch_lead_min', '20'),
  ('no_show_wait_s', '300'),
  ('avg_speed_kmh', '25')
ON CONFLICT (setting_key) DO NOTHING;
