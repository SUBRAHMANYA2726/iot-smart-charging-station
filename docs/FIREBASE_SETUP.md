# Firebase storage setup

The Render server stores real ThingSpeak entries in Cloud Firestore so the app can display durable sensor history. The browser never connects to Firestore directly and never receives a Firebase service-account key.

1. Firebase project `chargesense-station-01` is on the Spark (no-cost) plan and has a Standard Cloud Firestore `(default)` database in `nam5` (US multi-region). This location is permanent. Billing upgrades and scheduled backups are not enabled.
2. Firestore is initialized in production mode. The active rules deny all direct client reads and writes; the Render server accesses Firestore through the Admin SDK.
3. Render service `iot-smart-charging-station-api` has `FIREBASE_PROJECT_ID=chargesense-station-01` and the Firebase Admin service-account JSON stored as the secret `FIREBASE_SERVICE_ACCOUNT_JSON`. The values are not stored in this repository.
4. The latest Render deploy is live. The dashboard confirms Firebase history is connected.

The server uses the collection `stations/station-01/telemetry`, keyed by ThingSpeak entry ID. Repeated polling updates are idempotent, and only real channel readings are stored. Firestore security rules do not need public access because the server uses its private Admin SDK credentials.

Current data status: Firebase history is connected, but no ThingSpeak telemetry entries have arrived yet. The dashboard reports the ESP32 offline and is waiting for its first live update. Real samples will be persisted under `stations/station-01/telemetry` once the ESP32 publishes to the configured private channel.
