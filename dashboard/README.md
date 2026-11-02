# ChargeSense web dashboard and Android app

This Node web service displays real sensor values from the private ThingSpeak telemetry channel and sends guarded output requests through a separate private command channel. The interface adapts to desktop and mobile, and Android can install it from the HTTPS site as a Progressive Web App. It is not an APK from the Play Store.

The page does not contain demo readings, review widgets, or customer metrics. It shows no measurements until the ESP32 writes real values. Data older than the live window is marked offline, and stale sensor values are hidden.

## Configure ThingSpeak

Follow [the cloud guide](../docs/THINGSPEAK_SETUP.md) to create the private channels. Copy `.env.example` to `.env`, then set:

- Telemetry channel ID and Read API Key.
- Command channel ID, Read API Key, and Write API Key.
- A unique `DASHBOARD_PASSWORD`.

Keep `.env` private. It is excluded from Git. The browser never receives ThingSpeak keys. The ESP32 needs its own private `secrets.h` with the telemetry Write API Key and command Read API Key.

## Run on Windows

Install Node.js 20 or newer. From this directory run:

```powershell
Copy-Item .env.example .env
# Edit .env with your private channel values and dashboard password.
node server.mjs
```

Or double-click `Start-Dashboard.bat`. Open `http://localhost:3000`. Localhost is for development on that computer. Use a public HTTPS deployment for remote phone access and Android installation.

## Deploy to Render

The project root has a `render.yaml` Blueprint for this web service. Connect the repository that contains this project, then set the channel IDs, private API keys, and dashboard password as Render environment secrets. Keep the service at one instance because its login session records are held in memory. After deployment, check `/api/health`, sign in with the configured dashboard password, and open the secure address on Android to install.

No ThingSpeak credentials are included in this source package. Until the channels and keys are configured, the dashboard reports setup status and does not invent readings.
