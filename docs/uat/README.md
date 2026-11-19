# User acceptance testing, SUS and pilot (report 7.2, 7.4, 7.6)

Everything here is a kit. The numbers must come from real volunteers: do not fill the results in yourself.

| Report item | What you collect | Tool in this folder |
|---|---|---|
| 7.4 / Table 18 (6 tasks) | finished yes/no, time, where they got stuck, 2–3 quotes, changes you made | `task-sheet.html` (print one per volunteer), `results-template.csv` |
| 7.2.5 SUS | 10 ratings (1–5) per volunteer | last page of `task-sheet.html`, `sus-template.csv`, `npm --prefix server run sus -- docs/uat/sus.csv` |
| 7.6 Pilot | verified students, rides completed, pooled share, fuel cost shared, safety reports | `npm --prefix server run pilot-figures` (and the admin dashboard) |
| 7.2.4 Live-site timing (optional) | /ride load time, Ride Now to offer | last section of `task-sheet.html`, `timing-template.csv` |

## Before the sessions (set up, 30 minutes)

1. **Use the live site** (or the local one) and wake it up: open it once and wait for it to load (Render's free plan sleeps).
2. **Seed the demo drivers**: `npm --prefix server run demo-accounts` (Amina, Brian, Dan) so a driver is always available.
3. **Volunteers who drive**: each needs an *approved* driver account before the session, or they cannot go online. Two ways:
   - The real way: they apply (wizard), you approve in Admin > Driver verification. Allow time.
   - The quick way for UAT: `npm --prefix server run uat-approve-driver -- volunteer@demo.ridemate.test "Toyota Axio" KDA123A`. It marks them approved with a car and writes an audit entry (`verification.uat_approve`). **Say so in the report** ("driver accounts were approved by the administrator before testing").
4. **Volunteer accounts**: let each volunteer sign up themselves as part of Task 1, with an address like `firstname.lastname@demo.ridemate.test` (verified automatically, no inbox needed). Use their real USIU email only if you want to test the email check too.
5. **At least one driver must be online** (a team member on a second phone, signed in as Amina, tapped **Go online**, location set to Gate A) during Tasks 2 to 4.
6. Print one `task-sheet.html` per volunteer (Ctrl+P, A4). Have a phone stopwatch ready.

## Running a session (about 20 minutes each)

1. Read the intro on the sheet aloud. Say you are testing the app, not them.
2. Do not help unless they ask or are stuck for more than 2 minutes. Write down *where* they got stuck and *what* they said.
3. Start the stopwatch when they begin a task, stop when they finish (or give up: mark No).
4. Right after Task 6, hand over the SUS page. They fill it in alone, without discussing it.
5. Ask for 2 or 3 comments in their own words. Write them down without names.
6. Enter the row in `results-template.csv` and `sus-template.csv` that evening (copy the templates to `results.csv` and `sus.csv`).

## The 6 tasks (rename to match Table 18 if yours differ)

| # | Task | Counts as done when |
|---|---|---|
| 1 | Sign up as a student, complete the profile, reach the dashboard | They see their dashboard |
| 2 | Ride Now: find a destination (try typing a real address), request, see the driver coming | The driver's name and plate show on the map |
| 3 | Book a ride for tomorrow at 7:30, repeating Mon and Wed | It appears under Bookings |
| 4 | Confirm "This is my driver and car", finish the ride, rate the driver, say what share of the cost they paid | They say the right amount |
| 5 | On the dashboard, say how many rides they have taken and how much they owe | They read both correctly |
| 6 | Drivers: go online, accept a request, complete the ride. Non-drivers: open Become a driver and upload a licence photo | Ride completed / photo uploaded |

## Pilot (7.6): about one week

- Ask 10 to 20 students and a few drivers to use the real site for a week.
- Afterwards run `npm --prefix server run pilot-figures -- --since 2026-11-20` (use the start date). It prints the five figures and lists safety reports. Take screenshots of the admin dashboard too.
- **If there is no time for a pilot, tell your report writer.** 7.6 will be reworded as future work. Do not make figures up.

## What to write down for "changes made because of feedback"

Keep a list while testing: *what was seen*, *what you changed*, *the commit*. Fix small things between sessions (a confusing label, a hidden button) and note them. Example format:
"Three volunteers did not see the Ride button, so it became a pill in the top bar (commit abc123)."

## Ethics note for the report

Participation voluntary, no names recorded, comments anonymous, volunteers told they can stop at any time, no personal data entered (they use demo emails). Say this in 7.4.
