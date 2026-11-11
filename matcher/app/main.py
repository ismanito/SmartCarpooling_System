"""RideMate matching engine. Only the Express API talks to it, using a shared internal key."""
import hmac
import os
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException

from . import db
from .scoring import score_match

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="RideMate matcher", version="1.0.0")


def require_internal_key(x_internal_key: str = Header(default="")):
    expected = os.environ.get("MATCHER_INTERNAL_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="MATCHER_INTERNAL_KEY is not set")
    if not hmac.compare_digest(x_internal_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid internal key")


def rank(rows, settings):
    """Scores candidate rows and returns matches, best first."""
    matches = []
    for other_id, pickup_km, dropoff_km, time_diff_min, rider_km, driver_km in rows:
        fit = score_match(float(pickup_km), float(dropoff_km), float(time_diff_min), float(rider_km), float(driver_km), settings)
        if fit:
            matches.append(
                {
                    "id": other_id,
                    **fit,
                    "pickup_km": round(float(pickup_km), 2),
                    "dropoff_km": round(float(dropoff_km), 2),
                    "time_diff_min": round(float(time_diff_min), 1),
                }
            )
    return sorted(matches, key=lambda m: m["score"], reverse=True)


def _matches(kind, row_id):
    with db.connect() as conn:
        if not db.exists(conn, kind, row_id):
            raise HTTPException(status_code=404, detail="Not found")
        settings = db.load_settings(conn)
        return {"matches": rank(db.candidates(conn, kind, row_id, settings), settings)}


@app.get("/health")
def health():
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "database": "up"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database is not reachable") from None


@app.get("/v1/requests/{request_id}/matches", dependencies=[Depends(require_internal_key)])
def matches_for_request(request_id: UUID):
    """Offers that could carry this ride request."""
    return _matches("requests", request_id)


@app.get("/v1/offers/{offer_id}/matches", dependencies=[Depends(require_internal_key)])
def matches_for_offer(offer_id: UUID):
    """Ride requests this offer could carry."""
    return _matches("offers", offer_id)
