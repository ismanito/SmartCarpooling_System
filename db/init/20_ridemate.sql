-- Runs once, the first time the container's data volume is created.
-- Enables PostGIS + pgcrypto in the dev DB and creates a separate test DB.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DATABASE ridemate_test;
\connect ridemate_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
