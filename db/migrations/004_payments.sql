-- 004_payments.sql - the fare for each confirmed booking, and who pays which part of it

-- One payment per accepted booking: the rider's fare for the seats they booked.
CREATE TABLE payments (
  payment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings (booking_id) ON DELETE CASCADE,
  amount_kes  int  NOT NULL CHECK (amount_kes > 0),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The fare can be split between several people. Everyone has one share; the shares add up to the fare.
CREATE TABLE payment_shares (
  share_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments (payment_id) ON DELETE CASCADE,
  payer_id    uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  amount_kes  int  NOT NULL CHECK (amount_kes > 0),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  method      text CHECK (method IN ('mpesa', 'cash')),
  reference   text CHECK (char_length(reference) <= 40),
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, payer_id)
);
CREATE INDEX payment_shares_payer_idx ON payment_shares (payer_id, status);

CREATE TRIGGER payments_set_updated_at       BEFORE UPDATE ON payments       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_shares_set_updated_at BEFORE UPDATE ON payment_shares FOR EACH ROW EXECUTE FUNCTION set_updated_at();
