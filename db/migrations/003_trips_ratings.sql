-- 003_trips_ratings.sql - finishing a trip and rating the other person

ALTER TABLE ride_offers DROP CONSTRAINT ride_offers_status_check;
ALTER TABLE ride_offers ADD CONSTRAINT ride_offers_status_check CHECK (status IN ('open', 'cancelled', 'completed'));

ALTER TABLE ride_requests DROP CONSTRAINT ride_requests_status_check;
ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check CHECK (status IN ('open', 'matched', 'cancelled', 'completed'));

CREATE TABLE ratings (
  rating_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (booking_id) ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  ratee_id   uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  stars      int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text CHECK (char_length(comment) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id),
  CHECK (rater_id <> ratee_id)
);
CREATE INDEX ratings_ratee_idx ON ratings (ratee_id);
