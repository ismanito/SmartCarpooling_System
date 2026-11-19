-- Messages between a driver and one rider of a ride. In a pooled ride each rider has their own private thread
-- with the driver (rider_id is the rider side of the thread), so riders never see each other's messages.
CREATE TABLE ride_messages (
  message_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides (ride_id) ON DELETE CASCADE,
  rider_id    uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX ride_messages_thread_idx ON ride_messages (ride_id, rider_id, created_at);
CREATE INDEX ride_messages_unread_idx ON ride_messages (rider_id, sender_id) WHERE read_at IS NULL;
