# RideMate matcher

FastAPI matching engine (Python 3.12). It reads ride offers and requests from Postgres, filters them with PostGIS, and scores each pair using the weights in `system_settings`.

Only the Express API calls it, sending the shared `X-Internal-Key` header. If the matcher is not running, the API falls back to its built-in copy of the same rules, and its match responses report `engine: "builtin"` instead of `"matcher"`.

| Route | What it returns |
|---|---|
| `GET /health` | Whether the service and database are up |
| `GET /v1/requests/{id}/matches` | Offers that could carry this request, best first |
| `GET /v1/offers/{id}/matches` | Requests this offer could carry, best first |

From the repo root:

```powershell
npm run setup:matcher   # once: creates matcher/.venv and matcher/.env
npm run dev:matcher     # starts it on http://localhost:8000
npm run test:matcher    # runs pytest
```

`MATCHER_INTERNAL_KEY` must be the same in `matcher/.env` and `server/.env`.
