# Driver verification

Only a checked, approved driver can go online or be offered rides.

## Report paragraph

RideMate verifies every driver before they can carry passengers. Riders are always USIU-Africa students or staff, but drivers can be students, staff or external people, and each type has different checks. A driver completes a guided form: consent, ID, driving licence (which must have been held for at least one year), a live camera selfie, vehicle photos and logbook, and valid insurance that covers passengers. External drivers also give a certificate of good conduct and, where required, a PSV badge. Documents are stored privately, stripped of photo metadata, fingerprinted with SHA-256 and opened only through links that expire after five minutes and are logged. An admin compares the documents side by side, works through a checklist, and approves or rejects with a reason. External drivers also need an in-person check and approval by a senior admin, and the whole external track is off until a senior admin switches it on. Approved drivers get a windscreen sticker with a QR code that opens a public page showing the driver's first name, plate and verified status. Verification is kept alive: riders confirm "this is my driver and car" before a ride can start, drivers are sometimes asked for a fresh selfie before going online, low ratings or repeated incidents suspend a driver automatically, expired documents block driving, and every driver is re-verified every six months. Every step is written to a tamper-evident audit log.

## Status flow

`not_started → pending_review → approved | rejected → (expired | suspended)`

## Where things are

- Rules (pure functions): `server/src/lib/verification.js`
- Workflow and jobs: `server/src/services/verification.js`
- Private storage and signed links: `server/src/services/storage.js`, `server/src/lib/files.js`
- Routes: `server/src/routes/verification.js`
- Migration: `db/migrations/010_driver_verification.sql`
- Tests: `server/tests/verification.unit.test.js`, `server/tests/verification.test.js`
- Screenshots: `docs/screenshots/verification/`

## Configuration

- `SENIOR_ADMIN_EMAILS`: comma-separated admins who can approve external drivers and toggle the external track.
- `PRIVATE_DOCS_DIR`: where documents are stored (default `~/.ridemate-private-docs`). Keep it outside the web root.
- `DOC_SIGNING_SECRET`: secret for the 5-minute document links.
- Settings (admin, Matching settings tab): min licence years, expiry warning days, re-check months, document retention days, auto-suspend rating/ratings/incidents, random selfie percent, `external_drivers_enabled` (default false).

## External drivers apply before they have an account

External drivers (not students or staff) cannot simply sign up. The flow is:

1. They open `/apply`, give their name, email and phone, and get a reference code (shown once, stored only as a hash).
2. With that code they fill in the same wizard as everyone else: consent, ID, licence, live selfie, vehicle, insurance, good conduct certificate, PSV badge, inspection report.
3. When they submit, it appears in the admin verification queue. Approval needs a senior admin and the in-person check.
4. Only after approval can the same email create an account (Sign up, Driver). The approved application becomes the account, so documents, vehicle and approval carry over. A pending or rejected applicant cannot create an account.

Behind the scenes an applicant is a `users` row with a placeholder sign-in id (`applicant:<uuid>`) plus a `driver_applicants` row, so the admin review code is unchanged. Set `EXTERNAL_REQUIRE_APPLICATION=false` to go back to open Gmail sign-up with approval afterwards. Applications still need the external track switched on (`external_drivers_enabled`). Screenshots: `docs/screenshots/verification/19` to `21`.

## Known limits

- Storage is local; a cloud adapter is not built.
- Liveness is basic (live camera capture with prompted poses), not a certified liveness service.
- No phone OTP yet.
- Document files are not encrypted at rest beyond the operating system.
- Retention deletes files after the configured days but keeps their hashes.
