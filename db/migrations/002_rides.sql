-- 002_rides.sql – ride offers (drivers), ride requests (riders) and the bookings that match them

-- ---------------------------------------------------------------- ride offers
CREATE TABLE ride_offers (
  offer_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id         uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  vehicle_id        uuid NOT NULL REFERENCES vehicles (vehicle_id) ON DELETE CASCADE,
  origin_name       text NOT NULL,
  origin            geography(Point, 4326) NOT NULL,
  destination_name  text NOT NULL,
  destination       geography(Point, 4326) NOT NULL,
  depart_at         timestamptz NOT NULL,
  seats_total       int NOT NULL CHECK (seats_total BETWEEN 1 AND 7),
  seats_available   int NOT NULL CHECK (seats_available BETWEEN 0 AND seats_total),
  route_km          numeric(6,2) NOT NULL CHECK (route_km > 0),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_name <> destination_name)
);
CREATE INDEX ride_offers_driver_idx      ON ride_offers (driver_id, depart_at);
CREATE INDEX ride_offers_open_idx        ON ride_offers (depart_at) WHERE status = 'open';
CREATE INDEX ride_offers_origin_gix      ON ride_offers USING gist (origin);
CREATE INDEX ride_offers_destination_gix ON ride_offers USING gist (destination);

-- ---------------------------------------------------------------- ride requests
CREATE TABLE ride_requests (
  request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id          uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  origin_name       text NOT NULL,
  origin            geography(Point, 4326) NOT NULL,
  destination_name  text NOT NULL,
  destination       geography(Point, 4326) NOT NULL,
  depart_at         timestamptz NOT NULL,
  seats_needed      int NOT NULL CHECK (seats_needed BETWEEN 1 AND 7),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_name <> destination_name)
);
CREATE INDEX ride_requests_rider_idx      ON ride_requests (rider_id, depart_at);
CREATE INDEX ride_requests_open_idx       ON ride_requests (depart_at) WHERE status = 'open';
CREATE INDEX ride_requests_origin_gix     ON ride_requests USING gist (origin);
CREATE INDEX ride_requests_destination_gix ON ride_requests USING gist (destination);

-- ---------------------------------------------------------------- bookings
-- One rider request placed on one driver offer. Whoever starts it (initiated_by) waits for the other side.
CREATE TABLE bookings (
  booking_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES ride_offers (offer_id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES ride_requests (request_id) ON DELETE CASCADE,
  initiated_by  text NOT NULL CHECK (initiated_by IN ('rider', 'driver')),
  seats         int  NOT NULL CHECK (seats BETWEEN 1 AND 7),
  score         numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- At most one live booking between the same offer and request.
CREATE UNIQUE INDEX bookings_one_active_idx ON bookings (offer_id, request_id) WHERE status IN ('pending', 'accepted');
CREATE INDEX bookings_offer_idx   ON bookings (offer_id);
CREATE INDEX bookings_request_idx ON bookings (request_id);

CREATE TRIGGER ride_offers_set_updated_at   BEFORE UPDATE ON ride_offers   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ride_requests_set_updated_at BEFORE UPDATE ON ride_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bookings_set_updated_at      BEFORE UPDATE ON bookings      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
