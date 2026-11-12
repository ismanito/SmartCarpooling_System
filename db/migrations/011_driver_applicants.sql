-- External drivers apply BEFORE they have an account. An applicant is a users row with a placeholder sign-in id
-- ('applicant:<uuid>'); their verification record and documents hang off it exactly like a driver's, so the admin
-- review is the same. When the application is approved they sign up with the same email and the row is claimed.
CREATE TABLE driver_applicants (
  user_id     uuid PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,   -- sha-256 of the reference code the applicant keeps
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz
);
