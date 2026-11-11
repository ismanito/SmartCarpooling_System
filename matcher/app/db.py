"""Read-only database access. PostGIS does the coarse filter; scoring.py decides the final fit."""
import os

import psycopg

from .scoring import settings_from_rows

PAIR_METRICS = """
  ST_Distance(o.origin, r.origin) / 1000.0           AS pickup_km,
  ST_Distance(o.destination, r.destination) / 1000.0 AS dropoff_km,
  EXTRACT(EPOCH FROM (o.depart_at - r.depart_at)) / 60.0 AS time_diff_min,
  ST_Distance(r.origin, r.destination) / 1000.0      AS rider_km,
  ST_Distance(o.origin, o.destination) / 1000.0      AS driver_km
"""

PAIR_FILTER = """
      o.status = 'open' AND r.status = 'open'
  AND o.depart_at > now() AND r.depart_at > now()
  AND o.driver_id <> r.rider_id
  AND EXISTS (SELECT 1 FROM users d WHERE d.user_id = o.driver_id AND d.status = 'active')
  AND EXISTS (SELECT 1 FROM users q WHERE q.user_id = r.rider_id AND q.status = 'active')
  AND o.seats_available >= r.seats_needed
  AND ST_DWithin(o.origin, r.origin, %(radius)s * 1000)
  AND ST_DWithin(o.destination, r.destination, %(radius)s * 1000)
  AND abs(EXTRACT(EPOCH FROM (o.depart_at - r.depart_at))) <= %(window)s * 60
  AND NOT EXISTS (SELECT 1 FROM bookings b
                   WHERE b.offer_id = o.offer_id AND b.request_id = r.request_id
                     AND b.status IN ('pending', 'accepted', 'declined'))
"""


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(url, autocommit=True)


def load_settings(conn):
    return settings_from_rows(conn.execute("SELECT setting_key, setting_value FROM system_settings").fetchall())


def exists(conn, kind, row_id):
    table, column = ("ride_requests", "request_id") if kind == "requests" else ("ride_offers", "offer_id")
    return conn.execute(f"SELECT 1 FROM {table} WHERE {column} = %s", (row_id,)).fetchone() is not None


def candidates(conn, kind, row_id, settings):
    """Rows of (other_id, pickup_km, dropoff_km, time_diff_min, rider_km, driver_km)."""
    params = {"id": row_id, "radius": settings.search_radius_km, "window": settings.time_window_min}
    if kind == "requests":
        sql = f"""SELECT o.offer_id::text, {PAIR_METRICS}
                    FROM ride_requests r JOIN ride_offers o ON true
                   WHERE r.request_id = %(id)s AND {PAIR_FILTER} LIMIT 200"""
    else:
        sql = f"""SELECT r.request_id::text, {PAIR_METRICS}
                    FROM ride_offers o JOIN ride_requests r ON true
                   WHERE o.offer_id = %(id)s AND {PAIR_FILTER} LIMIT 200"""
    return conn.execute(sql, params).fetchall()
