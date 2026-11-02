# iot-smart-charging-station

ESP32 smart charging station with real ThingSpeak telemetry, Firebase sensor history, and an installable Android dashboard.

## ChargeSense Smart Charging Station

ESP32 firmware and a responsive web dashboard for a supervised, low-voltage smart charging station prototype. The ESP32 reads INA219 voltage and current plus DS18B20 temperature, enforces local cutoffs, and sends real sensor data to private ThingSpeak channels. The same dashboard works as a website and an installable Android web app.

## What is included

- ESP32 firmware with local over-temperature, voltage, current, and sensor-failure protection.
- A private ThingSpeak telemetry channel for eight live data fields and history.
- A separate private ThingSpeak command channel for guarded Start and Stop requests.
- A Vercel-hosted website and installable Android PWA backed by the Render Node service.
- Firebase Firestore history that stores real ThingSpeak sensor entries for the graph.
- Password protected server access, private key handling, a favicon, privacy page, terms page, and Render deployment configuration.
- Local LittleFS event/session records on the ESP32.

No sample or seeded sensor measurements are shown. Values remain blank until a real ESP32 sends them. The dashboard hides stale readings. The firmware keeps the output off at boot, rejects Start requests unless local checks pass, and disconnects the output if its cloud command link is lost.

## Set up the cloud and device

1. Follow [the ThingSpeak setup guide](docs/THINGSPEAK_SETUP.md) to create a private telemetry channel and a separate private command channel.
2. Install the Arduino IDE and required board/library packages. Copy `firmware/SmartChargingStation/secrets.example.h` to `secrets.h` and add Wi-Fi plus channel keys.
3. Follow [the build guide](docs/BUILD_GUIDE.md) and [wiring and safety guide](docs/WIRING_AND_SAFETY.md). Test only with a supervised, rated 5 V demo load.
4. Deploy the Render API and set the private ThingSpeak channel IDs and API keys, Firebase server credentials, Vercel origin, and a unique dashboard password in Render's environment settings. Never place these secrets in Git.
5. Deploy the website from this repository to Vercel. Open its HTTPS URL on Android and choose **Install app** or **Add to Home screen**. The website and installed app use the same Render backend; no local server is needed.

## Cloud fields

| Field | Measurement |
|---|---|
| 1 | Voltage, V |
| 2 | Current, A |
| 3 | Power, W |
| 4 | Temperature, °C |
| 5 | Charging, 0 or 1 |
| 6 | Safety state: starting, normal, warning, fault, or sensor error |
| 7 | Output enabled, 0 or 1 |
| 8 | Wi-Fi signal strength, dBm |

ThingSpeak free accounts accept writes at 15-second intervals. Firmware publishes at that interval. The Render API reads current values from ThingSpeak, stores real samples in Firestore, and serves them to the Vercel website and Android PWA. API keys are never sent to the browser.

## Publish

`render.yaml` defines the Render API service. `vercel.json` publishes `dashboard/public` as the website and installable Android PWA, and routes `/api/*` through Render so the website and app use the same backend. Deploy the Render service first, then make sure the Vercel rewrite destination in `vercel.json` matches its Render URL. Configure the five ThingSpeak environment values, Firebase service-account JSON, `FIREBASE_PROJECT_ID`, `PUBLIC_APP_ORIGINS`, and `DASHBOARD_PASSWORD` as private Render secrets/settings.

## Safety and project state

This is not a certified charger, battery-management system, or replacement for hardware protection. The starter thresholds are illustrative and must be checked against the exact supply, load, MOSFET, wiring, and sensors. Do not connect it to mains, a phone battery, or an unprotected battery. Read the safety guide before assembly.

The web app and firmware source are prepared for ThingSpeak and Firebase. They are not yet confirmed on the user's physical ESP32, exact modules, or a public hosted deployment. Real cloud readings begin only after the private channel keys are configured and the firmware is uploaded to hardware.
