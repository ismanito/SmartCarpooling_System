import pytest
from fastapi.testclient import TestClient

from app import main
from app.scoring import Settings, score_match, settings_from_rows

PERFECT = dict(pickup_km=0, dropoff_km=0, time_diff_min=0, rider_km=10, driver_km=10)
SOME_ID = "11111111-1111-1111-1111-111111111111"


def test_identical_trip_scores_one():
    fit = score_match(**PERFECT)
    assert fit["score"] == 1
    assert fit["detour_km"] == 0


@pytest.mark.parametrize(
    "change",
    [
        {"pickup_km": 2.5},
        {"dropoff_km": 2.1},
        {"time_diff_min": -16},
        {"time_diff_min": 20},
        {"pickup_km": 1.8, "dropoff_km": 1.8},
    ],
)
def test_rejects_pairs_outside_the_limits(change):
    assert score_match(**{**PERFECT, **change}) is None


def test_ranks_closer_better_timed_trips_higher():
    near = score_match(**{**PERFECT, "pickup_km": 0.2, "time_diff_min": 2})
    far = score_match(**{**PERFECT, "pickup_km": 1.5, "time_diff_min": 12})
    assert near["score"] > far["score"] > 0


def test_same_answer_as_the_api_built_in_rules():
    # Same input as the API's live match: USIU -> Westlands driver, TRM -> Westlands rider, 5 minutes apart.
    fit = score_match(1.1, 0, -5, 10, 10)
    weights = (0.5 * 1 + 0.3 * (1 - 5 / 15) + 0.2 * (1 - 1.1 / 3)) / 1.0
    assert fit["score"] == round(weights, 3)


def test_settings_use_the_database_and_ignore_bad_values():
    s = settings_from_rows([("w_overlap", "0"), ("w_time", "1"), ("w_detour", "0"), ("search_radius_km", "oops"), ("other", "9")])
    assert s.search_radius_km == Settings().search_radius_km
    assert score_match(**{**PERFECT, "rider_km": 1}, settings=s)["score"] == 1


def test_rank_sorts_best_first_and_drops_non_matches():
    rows = [("far", 1.5, 0, 12, 10, 10), ("near", 0.1, 0, 1, 10, 10), ("out", 9, 0, 0, 10, 10)]
    assert [m["id"] for m in main.rank(rows, Settings())] == ["near", "far"]


client = TestClient(main.app)


def test_routes_need_the_internal_key(monkeypatch):
    monkeypatch.setenv("MATCHER_INTERNAL_KEY", "secret")
    assert client.get(f"/v1/requests/{SOME_ID}/matches").status_code == 401
    assert client.get(f"/v1/offers/{SOME_ID}/matches", headers={"X-Internal-Key": "wrong"}).status_code == 401


def test_routes_refuse_when_no_key_is_configured(monkeypatch):
    monkeypatch.setenv("MATCHER_INTERNAL_KEY", "")
    assert client.get(f"/v1/requests/{SOME_ID}/matches", headers={"X-Internal-Key": ""}).status_code == 503


def test_malformed_id_is_rejected(monkeypatch):
    monkeypatch.setenv("MATCHER_INTERNAL_KEY", "secret")
    assert client.get("/v1/requests/not-a-uuid/matches", headers={"X-Internal-Key": "secret"}).status_code == 422
