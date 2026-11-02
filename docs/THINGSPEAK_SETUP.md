# ThingSpeak setup

ChargeSense uses ThingSpeak as the cloud relay. The ESP32 writes real sensor measurements to one private channel. The app writes start and stop requests to a separate private command channel. The ESP32 polls that command channel and makes the final decision using its local sensor and safety checks.

## Create the telemetry channel

In ThingSpeak, create a private channel named `ChargeSense Station 01` and enable these fields in order:

| Field | Name | Unit / meaning |
|---|---|---|
| 1 | Voltage | V |
| 2 | Current | A |
| 3 | Power | W |
| 4 | Temperature | °C |
| 5 | Charging | 0 or 1 |
| 6 | Safety state | 0 starting, 1 normal, 2 warning, 3 fault, 4 sensor error |
| 7 | Output enabled | 0 or 1 |
| 8 | WiFi RSSI | dBm |

Set the status field as the station message. The firmware sends a write every 15 seconds, which matches the ThingSpeak free-channel write interval.

## Create the command channel

Create a second private channel named `ChargeSense Output Commands`. Enable field 1 and name it `Output command` with `0 = stop` and `1 = start`. Do not reuse the telemetry channel for commands. The ESP32 ignores the last stored command after boot and waits for a newer entry, so a restart leaves the output off.

## Keep the keys private

In each channel's **API Keys** tab, use its channel ID and keys in the private configuration files. Do not paste API keys into a browser URL, screenshots, public source, or the client-side dashboard.

The ESP32 needs:

- Telemetry channel ID and its **Write API Key**.
- Command channel ID and its **Read API Key**.
- Wi-Fi SSID and password.

Copy `firmware/SmartChargingStation/secrets.example.h` to `firmware/SmartChargingStation/secrets.h` and fill in those values. `secrets.h` is excluded from Git.

The dashboard server needs:

- Telemetry channel ID and its **Read API Key**.
- Command channel ID, its **Read API Key**, and its **Write API Key**.
- A unique dashboard password.

Copy `dashboard/.env.example` to `dashboard/.env` and fill in those values. `.env` is excluded from Git. The dashboard sends only the password to its own server. ThingSpeak API keys stay on the server.

## Data flow

```text
INA219 + DS18B20 -> ESP32 -> private ThingSpeak telemetry channel -> Render server -> Firestore history -> Vercel website / installable Android PWA
Vercel website / PWA -> Render server -> private ThingSpeak command channel -> ESP32 local safety checks -> MOSFET output
```

Telemetry is written every 15 seconds. The firmware polls commands every 5 seconds and switches the output off if its control channel has been unreachable for 30 seconds. A local sensor fault or limit cutoff always overrides an app start request. The dashboard also blocks a start unless it sees recent normal telemetry in range.

ThingSpeak updates may take several seconds to appear. Remote controls require the web server to be reachable over HTTPS when used outside the local computer. The PWA is an installable web app, not a native Play Store package.

## Upload firmware

Install Arduino IDE 2, the Espressif ESP32 board support, Adafruit INA219, OneWire, DallasTemperature, and ArduinoJson libraries. Open `firmware/SmartChargingStation/SmartChargingStation.ino`, create the private `secrets.h`, choose the correct board and port, then upload. Open Serial Monitor at 115200 baud and verify the station starts with its output off, sensors are detected, and ThingSpeak accepts the first update.

Follow `WIRING_AND_SAFETY.md` and test with a supervised 5 V demo load. This prototype is not a certified phone or battery charger.
