"""Matching rules. Pure functions, no database, so they are easy to test."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    search_radius_km: float = 2
    time_window_min: float = 15
    max_detour_km: float = 3
    w_overlap: float = 0.5
    w_time: float = 0.3
    w_detour: float = 0.2


SETTING_KEYS = {
    "search_radius_km",
    "time_window_min",
    "max_detour_km",
    "w_overlap",
    "w_time",
    "w_detour",
}


def settings_from_rows(rows) -> Settings:
    """Builds Settings from (key, value) rows, ignoring unknown keys and bad values."""
    values = {}
    for key, value in rows:
        if key not in SETTING_KEYS:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number >= 0:
            values[key] = number
    return Settings(**values)


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def score_match(pickup_km, dropoff_km, time_diff_min, rider_km, driver_km, settings=Settings()):
    """Returns the fit of one offer/request pair, or None when the pair is not a match.

    The score weighs three things: how much of the trip overlaps, how close the departure
    times are, and how far the driver has to leave their route.
    """
    s = settings
    if pickup_km > s.search_radius_km or dropoff_km > s.search_radius_km:
        return None
    if abs(time_diff_min) > s.time_window_min:
        return None

    detour_km = pickup_km + dropoff_km
    if detour_km > s.max_detour_km:
        return None

    overlap = min(rider_km, driver_km) / max(rider_km, driver_km) if rider_km > 0 and driver_km > 0 else 0.0
    time_fit = _clamp01(1 - abs(time_diff_min) / s.time_window_min) if s.time_window_min > 0 else 1.0
    detour_fit = _clamp01(1 - detour_km / s.max_detour_km) if s.max_detour_km > 0 else 1.0

    total_weight = (s.w_overlap + s.w_time + s.w_detour) or 1
    score = _clamp01((s.w_overlap * overlap + s.w_time * time_fit + s.w_detour * detour_fit) / total_weight)

    return {
        "score": round(score, 3),
        "overlap": round(overlap, 3),
        "time_fit": round(time_fit, 3),
        "detour_km": round(detour_km, 2),
        "detour_fit": round(detour_fit, 3),
    }
