# Ride Now and Book

Students ask for a ride (**Ride Now**) or book one ahead (**Book**, optionally repeating). The system picks the nearest suitable online driver, pools students going to the same area into one car, and each student pays an equal share of the fuel cost for the part of the road they were in the car. No commission, no surge pricing.

Drivers no longer post trips. They go online and answer requests. The old trip-posting screens are kept under **Classic carpool (old)**, with a banner saying they are being retired. Nothing was deleted.

Screenshots of the rider, driver and admin flows are in [`docs/screenshots`](screenshots) (`01` to `24`, one real browser run), and of the three separate portals in [`docs/screenshots/portals`](screenshots/portals) (`01` to `18`).

There are three separate portals (student or staff, driver, admin), each with its own sign-up, dashboard and menu. See the README.

## Where things are

| Piece | Where |
|---|---|
| Pure maths (ETA, cheapest insertion, scoring, ranking, zones) | `server/src/lib/dispatch.js` |
| Fare by leg (`calculateLegFares`), share estimates | `server/src/lib/fare.js` |
| Dispatch loop, offers, accept/decline/expire, pooling, cancel | `server/src/services/dispatch.js` |
| Stops, no-show, completion, shares, live view, ratings, SOS | `server/src/services/rideOps.js` |
| Online/offline, position, the driver's screens | `server/src/services/driverApp.js` |
| Requests, bookings, repeats, the timer worker | `server/src/services/booking.js` |
| Zones | `server/src/services/zones.js`, tables in `db/migrations/008_dispatch.sql` |
| Real-time push (Socket.IO, token-checked) | `server/src/services/realtime.js` |
| Simulation | `server/scripts/simulate.js` |

## Dispatch, as built

**Asking for a ride (Ride Now)**

```
create request:
  tag pickup and drop-off with a zone
    smallest zone that contains the point; else nearest zone within 3 km; else refuse "Outside the pilot area"
  estimate the rider's share: alone with the driver, and pooled with two others
  save status=searching, write audit, then dispatch

dispatch(request):                       # one transaction, row lock on the request
  if another driver still holds an unanswered offer: stop
  if (Ride Now) offers already sent >= max_offers_per_request: status=no_driver, tell the rider, stop
  seats = this request's seats (a pooled booking group travels together, so all its seats)

  nearby = online drivers who
      have a vehicle, are verified, not suspended, are approved (or a student), and are not the rider
      have seats_free >= seats and reported a position in the last 90 s
      are within dispatch_radius_km of the pick-up            (PostGIS ST_DWithin, ordered by <->)
      were not already offered this request, and hold no other open offer

  for each driver in nearby:
    if the car is empty:
        pickup_eta = drive time driver -> pick-up; extra = 0; pooled = false
    else (already carrying riders):
        skip if riders aboard + 1 > max_riders_per_car
        skip unless every rider aboard goes to the same drop-off zone or a neighbouring one (zone_neighbours)
        try every place to slot the new pick-up and drop-off into the remaining stops
        keep the one that finishes soonest where no rider aboard arrives more than
            max_extra_minutes_per_rider later; skip the driver if none works
        pickup_eta = minutes until the new pick-up in that order; extra = total delay to riders aboard
    score = pickup_eta + 0.5 * extra

  rank: lowest score first; scores within 2 minutes count as close, and then a driver already carrying
        riders to the same zone comes first (more pooling), then the better rated driver
  if nobody: Ride Now -> no_driver;  booking -> keep searching until pick-up time
  offer to the best: status=offered, offer expires in offer_timeout_s, push it to the driver, audit

driver accepts:                          # locks request -> offer -> driver, in that order
  must hold the live, unexpired offer; request must still be 'offered'; seats must still fit
  place the request(s) into the driver's ride (cheapest insertion again, with fresh data)
  create the ride if the driver had none; renumber stops; take the seats
  status=assigned, audit, notify the rider and anyone already aboard
driver declines, or the offer expires (swept every 2 s): mark it, status=searching, dispatch the next driver
```

Because the lock order is fixed and one open offer per request is enforced, a request can never be assigned to two drivers, even when two accepts arrive together (there is a test that forces exactly that).

**Booking ahead.** A worker runs every 2 seconds. Bookings due within `scheduled_dispatch_lead_min` (20) are grouped when they share a drop-off zone, are picked up within 10 minutes of each other and within 3 km, and fit one car. A group is offered to one driver together. Bookings without a driver keep being offered to drivers (not the same driver twice within 90 s) until pick-up time, then become `no_driver` and the rider is told. Repeating bookings schedule the next two weeks of pick-ups and are topped up every 10 minutes.

**During the ride.** The driver taps Arrived (starts the wait, 5 minutes by default), then Picked up or, after the wait, No-show (cancels that rider, frees the seat, and ends the ride if the car is empty). Dropped off works out that rider's share straight away. Complete ride needs every stop done. Stops can be added while the car is under way.

**Cost sharing.** Stops are walked in the order they were actually done. Each stretch of road between two stops costs `km x fuel_rate` and is split equally between the riders in the car on that stretch plus the driver (who counts as one; two seats count as two people). A rider's share is the sum of their stretches, rounded to the nearest `fare_rounding_kes`. The driver keeps what is left, so the shares always add up exactly to the trip cost. Commission is always 0. The driver marks each share as paid (cash or M-Pesa happens outside the app).

**Live position.** One row per driver, overwritten, deleted when they go offline. A rider sees the car only while assigned or in the car, and not after their own drop-off. Other riders appear to each other only as an area (for example "another student going to Roysambu"), never as a name or place.

**Audit log.** Going online and offline (time and vehicle, never coordinates), offers sent, accepted, declined and expired, assignment, grouping, arrived, picked up, dropped off, no-show, cancellations, completion with totals, payments, ratings, SOS, and every admin change to zones and settings.

## Tests

Run `npm test` from the repo root.

| Suite | Result |
|---|---|
| Server (Jest, real Postgres/PostGIS) | 208 passed |
| Client (Vitest) | 41 passed |
| Matcher (pytest) | 13 passed |
| Real browser run (Playwright, Edge) | full journey, no browser errors |

The server suite includes `dispatch.unit.test.js` (maths), `dispatch.test.js` (the full flow: nearest-driver-first, decline and expiry passing on, never two drivers, concurrent accepts, offline/full/far/suspended/no-vehicle drivers never offered, pooling by zone, the rider limit, stop flow, by-leg shares adding up, no-show, cancelling, bookings grouped and dispatched at the lead time, repeating bookings, live location visibility and no history), `adminDispatch.test.js` (live map, zone editor, settings, request log, analytics), and every earlier Sprint I to III test. The audit chain still verifies after all of it.

## Simulation

`npm --prefix server run simulate` (uses the test database only; add `-- --seed 7 --drivers 20 --requests 60 --accept 0.85 --spread 0.2`). It places online drivers across the zones, sends requests, lets drivers accept 85% of offers, runs rides to completion in waves of 10 requests, and prints the figures.

Five seeds each, 20 drivers, 60 requests. About 60% of drivers wait near campus; 70% of riders go to campus, 15% leave it, 15% travel between other areas.

| Scenario | Avg pick-up ETA | Median | Worst | No-driver rate | Pooled rides | Riders per ride |
|---|---|---|---|---|---|---|
| Riders start anywhere in the pilot area (`--spread 1`) | 4.2 min | 2.6 min | 30.0 min | 35.3% | 8.7% | 1.1 |
| Most riders start near campus (`--spread 0.2`) | 2.8 min | 2.0 min | 20.5 min | 5.3% | 16.0% | 1.2 |

The first scenario spreads 60 riders over 16 zones with only 20 drivers, so many pick-ups have no driver within the 3 km search radius. It shows how much density matters. The second is closer to how the pilot would run (a campus and the roads around it). Pooling stays low because riders arrive one at a time and a car only takes a rider whose drop-off is in the same or a neighbouring zone and whose pick-up fits without delaying anyone aboard by more than 8 minutes. ETAs are estimates (straight line x 1.3 at 25 km/h), not Google drive times.

## Proposal sections that describe the old model

These still describe drivers posting trips and riders searching them, and need rewriting:

1. **Problem statement and objectives**: drivers "post trips"; now the system dispatches.
2. **User roles and use cases**: add Ride Now, Book, repeating booking, Go online, answer a request, stop-by-stop ride, SOS. Remove "post a trip", "search trips", "request a seat".
3. **Functional requirements**: trip posting and seat requests become requests, offers and dispatch. Matching "by route overlap" becomes zones plus cheapest insertion.
4. **Matching engine / algorithm design**: replace the route-overlap score with the dispatch score and the pooling rules above.
5. **Fare calculation**: a flat fuel split per trip becomes the by-leg split.
6. **System architecture**: add zones, driver status, dispatch offers, rides and stops, the timer worker and Socket.IO. The matcher service is no longer on the critical path.
7. **Database design / ERD**: add `zones`, `zone_neighbours`, `driver_status`, `trip_requests`, `dispatch_offers`, `rides`, `ride_stops`, `ride_shares` (migration 008). `ride_offers`, `ride_requests` and `bookings` are legacy.
8. **UI design and wireframes**: new map-first rider and driver screens, admin live map, zone editor and dispatch pages.
9. **Privacy and security**: location only while online, never stored as a history, shown only to riders in the ride and until drop-off.
10. **Testing plan**: add the dispatch, pooling, concurrency and simulation tests.
11. **Evaluation metrics**: use the simulation figures (pick-up ETA, pooling rate, no-driver rate, fill rate, wait time).
12. **Limitations and future work**: see the next section.

## Known limits and choices

- Dispatch runs in the Node API, not the FastAPI service. The audit log's hash chain is written in Node, and keeping the offer, lock and audit steps in one place makes "never two drivers" simple to guarantee. The FastAPI matcher still serves the classic carpool.
- Pick-up times use estimated drive times. The Google Distance Matrix is not wired in for dispatch.
- Zone boundaries are rough rectangles for the pilot area. The admin refines them in the zone editor (click two corners, or paste GeoJSON).
- Messaging between rider and driver is not built (Call is). Photos are initials. "Share trip" sends the car and plate by text, not a live link.
- Real GPS needs `https://` (or localhost). For demos, set `VITE_DEMO_TOOLS=true` to get a demo location picker on the driver screen.
- Payment happens outside the app; the driver marks shares as paid.
