# Firebase storage setup

The Render server stores real ThingSpeak entries in Cloud Firestore so the app can display durable sensor history. The browser never connects to Firestore directly and never receives a Firebase service-account key.

1. In Firebase Console, create a Firebase project and create a Cloud Firestore database.
2. In **Project settings → Service accounts**, generate a private key for the server service account. Keep the downloaded JSON private.
3. In Render, set `FIREBASE_PROJECT_ID` to the project ID and `FIREBASE_SERVICE_ACCOUNT_JSON` to the full JSON key as a secret environment value. Do not commit that JSON or copy it into the dashboard files.
4. Set `PUBLIC_APP_ORIGINS` to the exact Vercel site origin. Add a custom domain there as a comma-separated second origin if one is configured.
5. Redeploy the Render service. The dashboard graph reports Firebase history as connected only after the server writes and reads Firestore successfully.

The server uses the collection `stations/station-01/telemetry`, keyed by ThingSpeak entry ID. Repeated polling updates are idempotent, and only real channel readings are stored. Firestore security rules do not need public access because the server uses its private Admin SDK credentials.
