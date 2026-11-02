# Wiring and safety

Follow the plan's low-voltage prototype scope. Use a regulated 5 V USB/DC supply and a safe 5 V test load such as a small USB fan or rated resistor. Do not connect the prototype to 230 V AC. Do not bypass a phone or battery's certified charger/protection circuit.

## ESP32 pin map

| Module | Module pin | ESP32 / connection |
|---|---|---|
| INA219 | VCC | 3V3 |
| INA219 | GND | GND |
| INA219 | SDA | GPIO 21 |
| INA219 | SCL | GPIO 22 |
| DS18B20 | VCC | 3V3 |
| DS18B20 | GND | GND |
| DS18B20 | DATA | GPIO 4, with 4.7 kohm pull-up to 3V3 |
| OLED (optional) | VCC / GND | 3V3 / GND |
| OLED (optional) | SDA / SCL | GPIO 21 / GPIO 22 (shared I2C bus) |
| MOSFET module | IN / GATE | GPIO 26; verify 3.3 V logic compatibility and active polarity |
| Active buzzer | SIG / + | GPIO 27 (use a driver transistor if the buzzer current exceeds GPIO rating) |
| Status LED | Anode | GPIO 25 through 220 ohm resistor |
| Status LED | Cathode | GND |
| Reset button | One side | GPIO 33 (`INPUT_PULLUP`) |
| Reset button | Other side | GND |

Connect all low-voltage grounds together. Keep the ESP32 powered through its USB/regulated supply as appropriate for your board; do not feed an unverified voltage into its 3V3 pin.

## Low-voltage measurement and cutoff path

Use a MOSFET load-switch module rated for the exact load, current, voltage, and thermal conditions. Follow the INA219 module's VIN+/VIN- polarity and the MOSFET module's input/output labels. The intended series path is:

```text
5 V supply positive -> INA219 VIN+ -> INA219 VIN- -> MOSFET load switch -> 5 V test load positive
5 V supply ground -----------------------------------------------------> test load ground
ESP32 ground ----------------------------------------------------------> common ground
```

The INA219 module's VCC and logic wiring remain connected to the ESP32 as listed above. Check the exact module documentation before connecting the power path; breakout boards can label pins differently.

## Safe commissioning order

1. Keep the 5 V test load disconnected. Check wiring, common ground, INA219 polarity, DS18B20 pull-up, and the MOSFET input logic.
2. Upload firmware and confirm Serial Monitor reports the expected sensors.
3. Confirm the MOSFET is OFF during startup and when a sensor is disconnected.
4. Trigger each configured warning/fault condition using simulated readings or a safe low-voltage bench setup. Confirm the firmware latches cutoff, logs the event, and does not reconnect the load on its own.
5. Restore safe readings and use the physical button to clear the latch.
6. Connect only a known, rated 5 V demo load and monitor voltage/current/temperature while supervised.

Never use flame to heat the sensor. Do not test cutoff by shorting a supply, overloading the wiring, or connecting an actual phone/battery.

## Thresholds are hardware-specific

The firmware starter values are `4.50-5.50 V`, `1.00 A`, `40 C` warning (clears below `38 C`), and `50 C` cutoff. They are illustrative demo settings, not universal charging limits and not validated for your parts. Before energizing the load, change them to match the exact supply, test load, MOSFET module, wire gauge, connector, and sensor placement. If the module ratings or cutoff polarity are unknown, do not connect the load.

An ESP32 and software-only cutoff are not a certified charger, battery-management system, fuse, or independent thermal protection. Use a proper current-limited supply and hardware protection for all demonstrations.
