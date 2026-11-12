# Deploy RideMate on Render

`render.yaml` describes everything: a PostGIS Postgres database, the API, the matcher and the website.

## Before you start
1. The code must be on GitHub (it is, at ismanito/SmartCarpooling_System).
2. In the Firebase console (project `ridemate-demo-isa26`): Project settings > Service accounts > **Generate new private key**. Keep the JSON file; you upload it to Render below. Never commit it.
3. Firebase > Authentication > Settings > **Authorized domains**: add your Render website domain once you know it (`ridemate-web.onrender.com`).

## Create it
1. Render dashboard > **New > Blueprint** > choose the repo. Render reads `render.yaml`.
2. Fill the values marked `sync: false`:

| Service | Key | Value |
|---|---|---|
| ridemate-api | ADMIN_EMAILS, SENIOR_ADMIN_EMAILS | `ismahanabdijay@gmail.com` |
| ridemate-api | FIREBASE_PROJECT_ID | `ridemate-demo-isa26` |
| ridemate-api | CORS_ORIGIN, APP_URL | `https://ridemate-web.onrender.com` |
| ridemate-api | SMTP_* , MAIL_FROM | optional (without them emails are only logged) |
| ridemate-matcher | MATCHER_INTERNAL_KEY | copy the value Render generated for ridemate-api |
| ridemate-web | VITE_API_BASE_URL | `https://ridemate-api.onrender.com/api` |
| ridemate-web | VITE_SOCKET_URL | `https://ridemate-api.onrender.com` |
| ridemate-web | VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID | same as `client/.env` |

3. ridemate-api > **Environment > Secret Files**: add `firebase-service-account.json` with the key file's contents.
4. Wait for the first deploy. The API runs the database migrations before it starts.
5. Redeploy ridemate-web after setting its variables (they are baked in at build time).
6. Create the demo accounts against the live API: set `API_URL` to the API address and run `npm --prefix server run demo-accounts` with `DATABASE_URL` set to the database's **external** connection string.

## Notes
- The API uses the **Starter** plan and the database a paid plan: free web services sleep, cannot keep a disk (driver documents) and the free database expires.
- Driver documents live on the API's disk at `/var/data/private-docs`. Back them up before deleting the service.
- `DEMO_EMAIL_DOMAINS` lets `@demo.ridemate.test` accounts skip email checks. Clear it when you stop demonstrating.
