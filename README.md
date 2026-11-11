# RideMate

RideMate is a carpool matching platform for verified university students (USIU-Africa pilot). Drivers post trips, riders post what they need, and the system suggests matches by route and time. Phone numbers are shared only after both sides agree.

| Folder | What it is |
|---|---|
| `client/` | React + Vite + Tailwind CSS v4 web app |
| `server/` | Node.js + Express REST API |
| `matcher/` | Python 3.12 + FastAPI matching engine |
| `db/` | Numbered SQL migrations, seed data, and the Docker init script |

## What it does

**Accounts**
- Sign up with a university email only, verify it, then complete a profile
- Reset a forgotten password; log out
- Add, edit and delete vehicles

**Rides**
- Drivers post ride offers; riders post ride requests
- Matching scores each pair on route overlap, timing and detour
- Either side can start a booking; the other side accepts or declines
- Seats can't be oversold, and each trip shows a suggested fuel share per seat
- The driver finishes the trip, then both people rate each other

**Admin**
- Dashboard of figures, and a check that the audit log has not been altered
- Money overview: billed, collected and outstanding fares
- Incident reports with an audit trail, evidence export and decisions; analytics with CSV download
- Search students, suspend and reactivate them
- Read the audit log; change the matching settings

## Prerequisites (Windows, PowerShell)

```powershell
winget install --id Docker.DockerDesktop -e
winget install --id Python.Python.3.12 -e
winget install --id EclipseAdoptium.Temurin.21.JDK -e   # needed by the Firebase Auth Emulator
# Node.js 20+ is required (tested on Node 24)
```

Start Docker Desktop once after installing it. If Windows asks you to restart, do so before continuing, because Docker uses WSL2.

## Quick start

First time only, from the repo root:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
npm install
npm --prefix server install
npm --prefix client install
npm run setup:matcher
npm run db:up
npm --prefix server run migrate
npm --prefix server run migrate:test
npm --prefix server run seed
```

Every time after that:

1. Open Docker Desktop and wait until it is running.
2. Run `npm run dev` from the repo root.
3. Open http://localhost:5173 once the terminal shows "All emulators ready".

Stop it with **Ctrl+C** in that terminal. Closing the window instead loses any sign-ins created since the last clean stop.

| Address | What runs there |
|---|---|
| http://localhost:5173 | The website |
| http://localhost:4000 | Express API |
| http://localhost:8000 | Python matcher (`/docs` lists its routes) |
| http://localhost:4600 | Firebase Emulator UI (accounts) |

## Real verification emails (live Firebase)

The local emulator never sends email. To get real verification emails:

1. In the Firebase console create a project, then **Build > Authentication > Get started > Email/Password > Enable**.
2. **Project settings > Your apps > Web app**: copy the config into `client/.env` and set `VITE_FIREBASE_USE_EMULATOR=false` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`).
3. **Project settings > Service accounts > Generate new private key**. Save the JSON somewhere outside the repo.
4. In `server/.env` set `FIREBASE_USE_EMULATOR=false`, `FIREBASE_PROJECT_ID=<your project id>` and `GOOGLE_APPLICATION_CREDENTIALS=<full path to that JSON>`.
5. Run `npm run dev:live` (no emulator). Sign up, then open the email from Firebase (check spam) and click the link.

## Local test mode

With the Auth Emulator no real email is sent. Sign up with any `@usiu.ac.ke` address, then use **Verify instantly (local test mode)** on the verify page. Password reset links are printed in the terminal.

To try a full ride you need two accounts, so use a normal window and a private window. The **Finish trip** button appears from one hour before departure.

## Admins (not students)

Admins are staff, so they sign up with a real email address instead of a university one. Put the addresses in `server/.env`:

```
ADMIN_EMAILS=you@gmail.com
```

Restart the API, then sign up and verify that address as usual. Only the exact addresses listed get in (not the whole domain), they are made admins straight away, and they are not asked for a school. Admins see the Admin dashboard only: no rides or vehicles.

To promote someone who already has an account:

```powershell
npm --prefix server run make-admin -- someone@example.com
```

Log out and back in, and the Admin menu appears.

## Dashboards

| Who | Where | Shows |
|---|---|---|
| Rider | `/` | Upcoming rides, what you owe, fares you can pay or split with friends |
| Driver | `/driver` | Open trips, riders waiting for an answer, passengers and who has paid, money collected |
| Admin | `/admin` | Billed / collected / outstanding money, users, audit log, matching settings |

## Sharing the fare

When a driver and rider confirm a booking, a fare is created: the suggested per-seat fuel share times the seats booked. The rider can split it evenly with up to five other RideMate students by email. Each person pays their own share and records it as M-Pesa (with the confirmation code) or cash. The fare is marked paid when every share is paid, and the driver sees it straight away. Cancelling a booking cancels its fare.

RideMate does not move money yet. Payers send the money to the driver themselves and record it here. A real M-Pesa (Daraja STK push) integration would replace the "I have paid" step.

## Install on a phone

RideMate is an installable web app (PWA). Open the site in the phone's browser:

- **Android / Chrome:** tap **Install app** in the top bar (or the browser menu, then Install app).
- **iPhone / Safari:** tap **Install app** for the steps: Share, then Add to Home Screen.

Phones only offer installing over HTTPS, so use the staging or live site, not a plain `http://` address on your computer's network name. `http://localhost` also works for testing on the same machine. The service worker is on in production builds only (`npm --prefix client run build`, then `npm --prefix client run preview`).

## Live map

While a ride is open (from two hours before departure), the driver can tap **Share my live location** on Ride details. Their phone sends its GPS position every 4 seconds, and every rider with a confirmed seat sees the car move on their map, with the distance to the drop-off. Sharing stops when the driver stops it or finishes the ride, and the position is deleted then. Browsers only allow location on `https://` sites and on `localhost`.

For demos without driving, set `VITE_DEMO_TOOLS=true` in `client/.env` to show **Simulate a drive**, which moves the car from the pick-up to the drop-off in about a minute.

## Notifications and email

Every request, answer, cancellation, finished ride and safety report creates an in-app notification (the bell in the top bar). The key ones also send an email. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `server/.env`. Without `SMTP_HOST`, emails are printed in the API terminal instead.

## Ride Now and Book

Students tap **Ride Now** (or **Book**, optionally repeating on chosen days). The system offers the request to the nearest suitable online driver, pools students going to the same area into one car, and everyone pays an equal share of the fuel cost for the part of the road they shared. No commission, no surge pricing. Drivers go online (**Drive**) and answer requests; they no longer post trips.

Full details, the dispatch algorithm as built, test and simulation results, and the list of proposal sections to update are in [docs/RIDE_NOW.md](docs/RIDE_NOW.md). Screenshots are in `docs/screenshots`.

Demo (two phones or browser windows, and the admin): sign up with `name@demo.ridemate.test` addresses (verified automatically). Driver: add a vehicle, open **Drive**, pick a demo location, **GO ONLINE**. Rider: search "Roysambu", **Ride Now**, confirm. Driver: **Accept**. A second rider asking for the same area is pooled into the same car. Driver: Arrived, Picked up, Dropped off, slide to complete. Both rate. Admin: **Live map**, **Zones**, **Dispatch** (analytics, request log, settings).

`npm --prefix server run simulate` runs 20 drivers and 60 requests against the test database and prints the figures for the report.

The old trip-posting screens are kept under **Classic carpool (old)** until you confirm they can go.

## Classic carpool (deprecated): how a ride works

1. A rider asks for a seat (or a driver invites a rider). The other side gets a notification and an email.
2. The driver accepts or declines. Accepting locks the seat in one transaction, so two riders can never take the last seat.
3. When the driver finishes the ride, the real fuel cost (`distance x fuel rate`, rounded to the nearest `fare_rounding_kes`) is split evenly between everyone in the car, driver included. Any leftover shilling goes to the driver, and commission is always 0.
4. The driver marks each share as paid (or riders record their own payment). RideMate does not move money.
5. Everyone rates (1 to 5 stars, tags, comment). Anyone in the car can also report a safety problem; every admin is notified and the report is written to the audit log.
6. Admins review the report, see its audit trail with an integrity badge, export the evidence as a hashed JSON file, then dismiss, warn or suspend. Suspended people are locked out and their trips drop out of matching.

In this codebase a ride is a `ride_offers` row (the car trip) and a booking is one rider on it. Ride details live at `/rides/:offerId`.

## Admin console

Dashboard (figures, rides per week, top routes, estimated savings), Users, Incident reports, Payments, Audit log (filters and **Verify integrity**), Analytics (date range and CSV download) and Matching settings. The three matching weights must add up to 1.

## Demo script (about 5 minutes)

Use two browser windows (one private) plus the admin account. Start with `npm run dev`; on the verify page use **Verify instantly (local test mode)**.

1. **Sign up** a driver and a rider with `@usiu.ac.ke` addresses and finish both profiles. Sign up the admin with the address in `ADMIN_EMAILS`.
2. **Driver:** Vehicles, add a car. Offer a ride from Roysambu to Westlands leaving in about 30 minutes.
3. **Rider:** Find a ride, post a trip from TRM to Westlands leaving shortly after. The driver appears with a match score; tap to ask for a seat.
4. **Driver:** the bell shows a new request. Open **My rides**, Requests, and accept.
5. **Driver:** My rides, Upcoming, Ride details. Show the map and the people in the car, then **Mark completed**.
6. Show the **fare breakdown**: total, each share, no commission. Mark the rider's share as paid.
7. **Both:** rate each other with stars and tags.
8. **Rider:** on Ride details use **Report a safety problem** against the driver.
9. **Admin:** the bell shows the report. Open Incident reports, show the audit trail and the **Integrity verified** badge, **Export evidence**, then **Suspend** the driver.
10. Back on the driver's window the next click signs them out; from the rider's side the driver's trips no longer appear. In Audit log tap **Verify integrity**.

## Continuous integration and staging

`.github/workflows/ci.yml` runs on every push and pull request: backend and the end-to-end journey (`server/tests/e2e.test.js`, with PostGIS), the matcher, and the client (lint, tests, build). Pushes to `main` that pass then deploy to staging.

Staging layout: the client on Vercel (`client/vercel.json`), and the API, matcher and Postgres on Render (`render.yaml`, create it with New, then Blueprint). Before the first deploy:

| Where | Secret / setting | Value |
|---|---|---|
| GitHub secrets | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | From your Vercel account and project |
| GitHub secrets | `RENDER_API_DEPLOY_HOOK`, `RENDER_MATCHER_DEPLOY_HOOK` | Deploy hook URLs from each Render service |
| Vercel env | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_USE_EMULATOR=false` | From the Firebase web app settings |
| Render (API) | `ADMIN_EMAILS`, `CORS_ORIGIN`, `APP_URL`, `FIREBASE_PROJECT_ID`, `GOOGLE_MAPS_SERVER_KEY`, `SMTP_*`, `MAIL_FROM` | Your values |
| Render (API) | Secret File `firebase-service-account.json` | Firebase service account key |
| Render (matcher) | `MATCHER_INTERNAL_KEY` | Same value Render generated for the API |

Also replace `YOUR-RIDEMATE-API` in `client/vercel.json` with the Render API hostname. Deploy steps are skipped, not failed, while their secrets are missing.

## Tests

```powershell
npm test               # server, client and matcher
npm run test:matcher   # matcher only
```

Server tests need the database running.

## Maps

- The website's map uses OpenStreetMap, which needs no key.
- Pick-up and drop-off points come from a fixed list of Nairobi places in `server/src/lib/places.js`, with approximate coordinates.
- Without a key, road distance is estimated as 1.3 times the straight line. Set `GOOGLE_MAPS_SERVER_KEY` in `server/.env` to use Google's Distance Matrix API instead; it falls back to the estimate if Google can't be reached.

## If the matcher is not running

The API falls back to its built-in copy of the same rules. Match responses report `engine: "matcher"` or `engine: "builtin"` so you can see which one answered.
