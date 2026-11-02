# Build guide

## Install firmware dependencies

In Arduino IDE 2, install the Espressif ESP32 board package, then install these libraries through Library Manager:

- Adafruit INA219
- OneWire
- DallasTemperature
- ArduinoJson
- (Optional OLED) Adafruit SSD1306 and Adafruit GFX Library

The ESP32 board package provides WiFi, TLS, HTTP, Wire, LittleFS, and FreeRTOS support.

## Configure credentials

1. Follow `THINGSPEAK_SETUP.md` to create the private telemetry and command channels.
2. Copy `secrets.example.h` to `secrets.h` in the sketch folder.
3. Add Wi-Fi SSID and password, the telemetry channel ID and Write API Key, and the command channel ID and Read API Key.
4. Keep `secrets.h` private. The root `.gitignore` excludes it.

## Board settings

- Board: ESP32 Dev Module or the matching profile for your specific board.
- Select the correct serial port and upload speed supported by the board.
- Serial Monitor: 115200 baud.
- OLED: leave `ENABLE_OLED 0` unless an SSD1306 and its libraries are installed.

## Firmware behavior

- MOSFET output is set to OFF before sensors or Wi-Fi initialize. A restart never restores a previously stored Start command.
- Sensor loss, over-temperature, over-current, or out-of-range voltage latches a local cutoff.
- The GPIO33 button clears a fault only after readings return inside configured bounds. Reset keeps the output off until a new app Start request.
- Wi-Fi and ThingSpeak work runs on a separate FreeRTOS task so network waits do not pause the local safety loop.
- Firmware sends telemetry every 15 seconds and polls commands every 5 seconds.
- Start requests are accepted only with fresh, valid, normal readings below the warning threshold. Local protection can reject a cloud request.
- If the command channel is unreachable for 30 seconds while the output is requested on, firmware disconnects the output.
- LittleFS records a bounded event/session history. If mounting fails, firmware attempts to format the partition. That recovery can erase existing local history.

Read `WIRING_AND_SAFETY.md` before wiring. The starter limits are examples for a supervised low-voltage demonstration and need validation against the actual hardware.
