-- 007_live_location.sql - the driver's latest position while a ride is under way (one row per ride, overwritten)
CREATE TABLE ride_locations (
  offer_id   uuid PRIMARY KEY REFERENCES ride_offers (offer_id) ON DELETE CASCADE,
  driver_id  uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading    real CHECK (heading BETWEEN 0 AND 360),
  speed_kmh  real CHECK (speed_kmh >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
