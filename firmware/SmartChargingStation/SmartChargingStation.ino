#include "secrets.h"
#include <Adafruit_INA219.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LittleFS.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include <string.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

// DigiCert Global G2 TLS RSA SHA256 2020 CA1, verified from api.thingspeak.com.
// TLS certificate validation is enabled; do not replace this with setInsecure().
static const char THINGSPEAK_CA_CERT[] PROGMEM = R"THINGSPEAK_CA(
-----BEGIN CERTIFICATE-----
MIIEyDCCA7CgAwIBAgIQDPW9BitWAvR6uFAsI8zwZjANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMTAzMzAwMDAwMDBaFw0zMTAzMjkyMzU5NTlaMFkxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpY2VydCBJbmMxMzAxBgNVBAMTKkRpZ2lDZXJ0IEdsb2Jh
bCBHMiBUTFMgUlNBIFNIQTI1NiAyMDIwIENBMTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAMz3EGJPprtjb+2QUlbFbSd7ehJWivH0+dbn4Y+9lavyYEEV
cNsSAPonCrVXOFt9slGTcZUOakGUWzUb+nv6u8W+JDD+Vu/E832X4xT1FE3LpxDy
FuqrIvAxIhFhaZAmunjZlx/jfWardUSVc8is/+9dCopZQ+GssjoP80j812s3wWPc
3kbW20X+fSP9kOhRBx5Ro1/tSUZUfyyIxfQTnJcVPAPooTncaQwywa8WV0yUR0J8
osicfebUTVSvQpmowQTCd5zWSOTOEeAqgJnwQ3DPP3Zr0UxJqyRewg2C/Uaoq2yT
zGJSQnWS+Jr6Xl6ysGHlHx+5fwmY6D36g39HaaECAwEAAaOCAYIwggF+MBIGA1Ud
EwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFHSFgMBmx9833s+9KTeqAx2+7c0XMB8G
A1UdIwQYMBaAFE4iVCAYlebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwdgYIKwYBBQUHAQEEajBoMCQG
CCsGAQUFBzABhhhodHRwOi8vb2NzcC5kaWdpY2VydC5jb20wQAYIKwYBBQUHMAKG
NGh0dHA6Ly9jYWNlcnRzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEdsb2JhbFJvb3RH
Mi5jcnQwQgYDVR0fBDswOTA3oDWgM4YxaHR0cDovL2NybDMuZGlnaWNlcnQuY29t
L0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDA9BgNVHSAENjA0MAsGCWCGSAGG/WwC
ATAHBgVngQwBATAIBgZngQwBAgEwCAYGZ4EMAQICMAgGBmeBDAECAzANBgkqhkiG
9w0BAQsFAAOCAQEAkPFwyyiXaZd8dP3A+iZ7U6utzWX9upwGnIrXWkOH7U1MVl+t
wcW1BSAuWdH/SvWgKtiwla3JLko716f2b4gp/DA/JIS7w7d7kwcsr4drdjPtAFVS
slme5LnQ89/nD/7d+MS5EHKBCQRfz5eeLjJ1js+aWNJXMX43AYGyZm0pGrFmCW3R
bpD0ufovARTFXFZkAdl9h6g4U5+LXUZtXMYnhIHUfoyMo5tS58aI7Dd8KvvwVVo4
chDYABPPTHPbqjc1qCmBaZx2vN4Ye5DUys/vZwP9BFohFrH/6j/f3IL16/RZkiMN
JCqVJUzKoZHm1Lesh3Sz8W2jmdv51b2EQJ8HmA==
-----END CERTIFICATE-----
)THINGSPEAK_CA";

// Optional 128x64 SSD1306 OLED on the shared I2C bus.
#define ENABLE_OLED 0
#if ENABLE_OLED
  #include <Adafruit_GFX.h>
  #include <Adafruit_SSD1306.h>
  #define OLED_WIDTH 128
  #define OLED_HEIGHT 64
  Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
#endif

// Pin map from the supplied ESP32 plan.
constexpr uint8_t PIN_I2C_SDA = 21;
constexpr uint8_t PIN_I2C_SCL = 22;
constexpr uint8_t PIN_DS18B20 = 4;
constexpr uint8_t PIN_MOSFET = 26;
constexpr uint8_t PIN_BUZZER = 27;       // Active buzzer module
constexpr uint8_t PIN_STATUS_LED = 25;    // LED + 220 ohm resistor
constexpr uint8_t PIN_RESET_BUTTON = 33;  // Button to GND, INPUT_PULLUP

// Set this to LOW if your MOSFET module turns on with a LOW input.
constexpr uint8_t MOSFET_ON_LEVEL = HIGH;
constexpr uint8_t MOSFET_OFF_LEVEL = (MOSFET_ON_LEVEL == HIGH) ? LOW : HIGH;

// Starter limits for a supervised 5 V classroom demo only.
// Re-check every limit against the exact supply, load, MOSFET, wiring, and sensor.
constexpr float VOLTAGE_MIN_V = 4.50f;
constexpr float VOLTAGE_MAX_V = 5.50f;
constexpr float CURRENT_MAX_A = 1.00f;
constexpr float CHARGING_DETECT_A = 0.08f;
constexpr float TEMP_WARNING_C = 40.0f;
constexpr float TEMP_WARNING_CLEAR_C = 38.0f; // hysteresis avoids alert chatter
constexpr float TEMP_CUTOFF_C = 50.0f;

constexpr uint32_t SENSOR_INTERVAL_MS = 2000;
constexpr uint32_t CLOUD_INTERVAL_MS = 15000; // Free ThingSpeak channels accept one write every 15 seconds.
constexpr uint32_t CONTROL_POLL_INTERVAL_MS = 5000;
constexpr uint32_t CONTROL_LINK_TIMEOUT_MS = 30000;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
constexpr char HISTORY_PATH[] = "/history.csv";
constexpr size_t HISTORY_MAX_BYTES = 32 * 1024;

Adafruit_INA219 ina219;
OneWire oneWire(PIN_DS18B20);
DallasTemperature temperatureSensor(&oneWire);
WiFiClientSecure cloudClient;

struct Readings {
  float voltageV = 0.0f;
  float currentA = 0.0f;
  float powerW = 0.0f;
  float temperatureC = DEVICE_DISCONNECTED_C;
};

Readings readings;
struct CloudSnapshot {
  float voltageV;
  float currentA;
  float powerW;
  float temperatureC;
  uint8_t state;
  int rssi;
  bool measurementValid;
  bool charging;
  bool outputEnabled;
  char alert[96];
};
CloudSnapshot cloudSnapshot = {};
portMUX_TYPE cloudSnapshotMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE commandMux = portMUX_INITIALIZER_UNLOCKED;
volatile int pendingRemoteCommand = -1;
bool hardwareReady = false;
bool measurementValid = false;
bool loadEnabled = false;
bool remoteOutputRequested = false;
bool faultLatched = false;
bool warningActive = false;
bool historyReady = false;
bool charging = false;

// 0=starting, 1=normal, 2=warning, 3=fault, 4=sensor error.
enum DeviceState : uint8_t { STATE_STARTING, STATE_NORMAL, STATE_WARNING, STATE_FAULT, STATE_SENSOR_ERROR };
enum FaultCode : uint8_t { FAULT_NONE, FAULT_SENSOR, FAULT_TEMPERATURE, FAULT_CURRENT, FAULT_VOLTAGE };
DeviceState deviceState = STATE_STARTING;
FaultCode faultCode = FAULT_NONE;
char lastAlert[96] = "Starting up; load remains disconnected";

uint32_t lastSensorMs = 0;
uint32_t lastWiFiAttemptMs = 0;
uint32_t lastCloudWriteMs = 0;
uint32_t lastControlPollMs = 0;
volatile uint32_t lastControlResponseMs = 0;
uint32_t lastButtonChangeMs = 0;
bool clockSyncStarted = false;
bool commandBaselineReady = false;
long lastCommandEntryId = 0;
bool buttonStableState = HIGH;
bool buttonLastRawState = HIGH;

bool sessionActive = false;
uint32_t sessionStartMs = 0;
uint32_t lastEnergySampleMs = 0;
uint32_t sessionSamples = 0;
float sessionCurrentSumA = 0.0f;
float sessionVoltageSumV = 0.0f;
float sessionPeakTempC = -1000.0f;
float sessionEnergyWhEstimate = 0.0f;

void publishCloudSnapshot() {
  portENTER_CRITICAL(&cloudSnapshotMux);
  cloudSnapshot.voltageV = readings.voltageV;
  cloudSnapshot.currentA = readings.currentA;
  cloudSnapshot.powerW = readings.powerW;
  cloudSnapshot.temperatureC = readings.temperatureC;
  cloudSnapshot.state = static_cast<uint8_t>(deviceState);
  cloudSnapshot.rssi = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  cloudSnapshot.measurementValid = measurementValid;
  cloudSnapshot.charging = charging;
  cloudSnapshot.outputEnabled = loadEnabled;
  strncpy(cloudSnapshot.alert, lastAlert, sizeof(cloudSnapshot.alert) - 1);
  cloudSnapshot.alert[sizeof(cloudSnapshot.alert) - 1] = '\0';
  portEXIT_CRITICAL(&cloudSnapshotMux);
}

CloudSnapshot takeCloudSnapshot() {
  CloudSnapshot snapshot;
  portENTER_CRITICAL(&cloudSnapshotMux);
  snapshot = cloudSnapshot;
  portEXIT_CRITICAL(&cloudSnapshotMux);
  return snapshot;
}

void queueRemoteCommand(int command) {
  portENTER_CRITICAL(&commandMux);
  pendingRemoteCommand = command;
  portEXIT_CRITICAL(&commandMux);
}

int takeRemoteCommand() {
  portENTER_CRITICAL(&commandMux);
  const int command = pendingRemoteCommand;
  pendingRemoteCommand = -1;
  portEXIT_CRITICAL(&commandMux);
  return command;
}

const char* stateName(DeviceState state) {
  switch (state) {
    case STATE_NORMAL: return "NORMAL";
    case STATE_WARNING: return "WARNING";
    case STATE_FAULT: return "FAULT";
    case STATE_SENSOR_ERROR: return "SENSOR ERROR";
    default: return "STARTING";
  }
}

void writeLocalHistory(const char* eventName, const char* detail) {
  if (!historyReady) return;
  File file = LittleFS.open(HISTORY_PATH, FILE_APPEND);
  if (!file) return;
  file.printf("%lu,%s,%.3f,%.3f,%.3f,%.2f,%s\n",
              static_cast<unsigned long>(millis()), eventName,
              readings.voltageV, readings.currentA, readings.powerW,
              readings.temperatureC, detail);
  file.close();

  File check = LittleFS.open(HISTORY_PATH, FILE_READ);
  if (check && check.size() > HISTORY_MAX_BYTES) {
    check.close();
    // Keep the header and newest entries; rewrite a bounded tail.
    File input = LittleFS.open(HISTORY_PATH, FILE_READ);
    String contents;
    if (input) {
      contents.reserve(HISTORY_MAX_BYTES + 256);
      String line;
      while (input.available()) {
        line = input.readStringUntil('\n');
        contents += line;
        contents += '\n';
      }
      input.close();
      const unsigned int retainBytes = HISTORY_MAX_BYTES / 2;
      const unsigned int startAt = contents.length() > retainBytes
                                     ? contents.length() - retainBytes : 0;
      const int cutAt = contents.indexOf('\n', startAt);
      String tail = cutAt >= 0 ? contents.substring(cutAt + 1) : contents;
      const char header[] = "uptime_ms,event,voltage_V,current_A,power_W,temp_C,detail\n";
      LittleFS.remove(HISTORY_PATH);
      File output = LittleFS.open(HISTORY_PATH, FILE_WRITE);
      if (output) {
        output.print(header);
        output.print(tail);
        output.close();
      }
    }
  } else if (check) {
    check.close();
  }
}

void cloudEvent(const char* eventCode, const char* message) {
  Serial.print("[");
  Serial.print(eventCode);
  Serial.print("] ");
  Serial.println(message);
}

void setLoadEnabled(bool enabled) {
  loadEnabled = enabled;
  digitalWrite(PIN_MOSFET, enabled ? MOSFET_ON_LEVEL : MOSFET_OFF_LEVEL);
}

void latchFault(FaultCode code, const char* message) {
  if (faultLatched) return;
  faultLatched = true;
  faultCode = code;
  warningActive = false;
  remoteOutputRequested = false;
  setLoadEnabled(false);
  strncpy(lastAlert, message, sizeof(lastAlert) - 1);
  lastAlert[sizeof(lastAlert) - 1] = '\0';
  deviceState = (code == FAULT_SENSOR) ? STATE_SENSOR_ERROR : STATE_FAULT;
  writeLocalHistory("FAULT", lastAlert);
  cloudEvent("safety_fault", lastAlert);
  Serial.print("SAFETY CUTOFF: ");
  Serial.println(lastAlert);
}

bool valuesWithinLimits() {
  return hardwareReady && measurementValid &&
         readings.temperatureC < TEMP_CUTOFF_C &&
         readings.currentA <= CURRENT_MAX_A && readings.currentA >= -CURRENT_MAX_A &&
         readings.voltageV >= VOLTAGE_MIN_V && readings.voltageV <= VOLTAGE_MAX_V;
}

void evaluateSafety() {
  if (!hardwareReady || !measurementValid) {
    latchFault(FAULT_SENSOR, "Sensor missing or measurement invalid; load disconnected");
    return;
  }
  if (readings.temperatureC >= TEMP_CUTOFF_C) {
    latchFault(FAULT_TEMPERATURE, "Temperature limit reached; load disconnected");
    return;
  }
  if (fabsf(readings.currentA) > CURRENT_MAX_A) {
    latchFault(FAULT_CURRENT, "Current limit exceeded; load disconnected");
    return;
  }
  if (readings.voltageV < VOLTAGE_MIN_V || readings.voltageV > VOLTAGE_MAX_V) {
    latchFault(FAULT_VOLTAGE, "Voltage outside configured range; load disconnected");
    return;
  }
  if (faultLatched) {
    setLoadEnabled(false);
    deviceState = (faultCode == FAULT_SENSOR) ? STATE_SENSOR_ERROR : STATE_FAULT;
    return;
  }

  const bool nowWarning = warningActive
                            ? readings.temperatureC >= TEMP_WARNING_CLEAR_C
                            : readings.temperatureC >= TEMP_WARNING_C;
  if (nowWarning && !warningActive) {
    snprintf(lastAlert, sizeof(lastAlert), "Temperature warning: %.1f C", readings.temperatureC);
    writeLocalHistory("WARNING", lastAlert);
    cloudEvent("safety_warning", lastAlert);
  }
  warningActive = nowWarning;
  deviceState = warningActive ? STATE_WARNING : STATE_NORMAL;
  setLoadEnabled(remoteOutputRequested);
}

void readSensors() {
  const float tempC = temperatureSensor.getTempCByIndex(0);
  const float busV = ina219.getBusVoltage_V();
  const float shuntMv = ina219.getShuntVoltage_mV();
  const float currentA = ina219.getCurrent_mA() / 1000.0f;
  const float powerW = ina219.getPower_mW() / 1000.0f;
  const float loadV = busV + (shuntMv / 1000.0f);

  measurementValid = isfinite(tempC) && tempC != DEVICE_DISCONNECTED_C &&
                     isfinite(loadV) && isfinite(currentA) && isfinite(powerW);
  if (measurementValid) {
    readings.temperatureC = tempC;
    readings.voltageV = loadV;
    readings.currentA = currentA;
    readings.powerW = powerW;
  }
  evaluateSafety();
  updateChargingSession();
  temperatureSensor.requestTemperatures();
}

void updateChargingSession() {
  const bool nowCharging = loadEnabled && readings.currentA >= CHARGING_DETECT_A;
  const uint32_t now = millis();
  if (nowCharging && !sessionActive) {
    sessionActive = true;
    sessionStartMs = now;
    lastEnergySampleMs = now;
    sessionSamples = 0;
    sessionCurrentSumA = 0.0f;
    sessionVoltageSumV = 0.0f;
    sessionPeakTempC = readings.temperatureC;
    sessionEnergyWhEstimate = 0.0f;
    writeLocalHistory("SESSION_START", "charging detected");
  }
  if (nowCharging && sessionActive && measurementValid) {
    sessionSamples++;
    sessionCurrentSumA += readings.currentA;
    sessionVoltageSumV += readings.voltageV;
    if (readings.temperatureC > sessionPeakTempC) sessionPeakTempC = readings.temperatureC;
    const uint32_t elapsed = now - lastEnergySampleMs;
    sessionEnergyWhEstimate += readings.powerW * (static_cast<float>(elapsed) / 3600000.0f);
    lastEnergySampleMs = now;
  }
  if (!nowCharging && sessionActive) {
    const float averageCurrent = sessionSamples ? sessionCurrentSumA / sessionSamples : 0.0f;
    const float averageVoltage = sessionSamples ? sessionVoltageSumV / sessionSamples : 0.0f;
    char summary[96];
    snprintf(summary, sizeof(summary), "seconds=%lu avgV=%.2f avgA=%.3f peakC=%.1f energyEstimateWh=%.4f",
             static_cast<unsigned long>((now - sessionStartMs) / 1000), averageVoltage,
             averageCurrent, sessionPeakTempC, sessionEnergyWhEstimate);
    writeLocalHistory("SESSION_END", summary);
    sessionActive = false;
  }
  charging = nowCharging;
}

void updateButton() {
  const bool raw = digitalRead(PIN_RESET_BUTTON);
  const uint32_t now = millis();
  if (raw != buttonLastRawState) {
    buttonLastRawState = raw;
    lastButtonChangeMs = now;
  }
  if ((now - lastButtonChangeMs) >= BUTTON_DEBOUNCE_MS && raw != buttonStableState) {
    buttonStableState = raw;
    if (buttonStableState == LOW && faultLatched && valuesWithinLimits()) {
      faultLatched = false;
      faultCode = FAULT_NONE;
      warningActive = readings.temperatureC >= TEMP_WARNING_C;
      deviceState = warningActive ? STATE_WARNING : STATE_NORMAL;
      remoteOutputRequested = false;
      strncpy(lastAlert, "Fault reset locally; output remains off until started in the app", sizeof(lastAlert) - 1);
      lastAlert[sizeof(lastAlert) - 1] = '\0';
      setLoadEnabled(false);
      writeLocalHistory("RESET", lastAlert);
      cloudEvent("safety_warning", lastAlert);
      Serial.println(lastAlert);
    }
  }
}

void maintainNetwork() {
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED && (now - lastWiFiAttemptMs >= WIFI_RETRY_MS)) {
    lastWiFiAttemptMs = now;
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (WiFi.status() == WL_CONNECTED && !clockSyncStarted) {
    configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
    clockSyncStarted = true;
  }
}

bool cloudClockReady() {
  return time(nullptr) > 1700000000;
}

String urlEncode(const String& input) {
  const char hex[] = "0123456789ABCDEF";
  String output;
  output.reserve(input.length() * 3);
  for (size_t i = 0; i < input.length(); ++i) {
    const uint8_t c = static_cast<uint8_t>(input[i]);
    const bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                      (c >= '0' && c <= '9') || c == '-' || c == '_' ||
                      c == '.' || c == '~';
    if (safe) output += static_cast<char>(c);
    else {
      output += '%';
      output += hex[(c >> 4) & 0x0F];
      output += hex[c & 0x0F];
    }
  }
  return output;
}

void applyRemoteCommand(bool requested) {
  if (!requested) {
    remoteOutputRequested = false;
    setLoadEnabled(false);
    strncpy(lastAlert, "Output stopped from the ChargeSense app", sizeof(lastAlert) - 1);
    lastAlert[sizeof(lastAlert) - 1] = '\0';
    writeLocalHistory("APP_STOP", lastAlert);
    Serial.println(lastAlert);
    return;
  }

  const bool safeToStart = !faultLatched && measurementValid &&
                           deviceState == STATE_NORMAL && valuesWithinLimits() &&
                           readings.temperatureC < TEMP_WARNING_C;
  if (!safeToStart) {
    remoteOutputRequested = false;
    setLoadEnabled(false);
    strncpy(lastAlert, "App start denied; local sensor checks are not in the normal range", sizeof(lastAlert) - 1);
    lastAlert[sizeof(lastAlert) - 1] = '\0';
    writeLocalHistory("APP_START_DENIED", lastAlert);
    cloudEvent("safety_warning", lastAlert);
    return;
  }

  remoteOutputRequested = true;
  setLoadEnabled(true);
  strncpy(lastAlert, "Output enabled from the ChargeSense app", sizeof(lastAlert) - 1);
  lastAlert[sizeof(lastAlert) - 1] = '\0';
  writeLocalHistory("APP_START", lastAlert);
  Serial.println(lastAlert);
}

void pollCloudCommand() {
  if (WiFi.status() != WL_CONNECTED || !cloudClockReady()) return;

  const String url = String("https://api.thingspeak.com/channels/") +
                     String(THINGSPEAK_CONTROL_CHANNEL_ID) +
                     "/feeds/last.json?api_key=" +
                     urlEncode(String(THINGSPEAK_CONTROL_READ_API_KEY));
  cloudClient.setCACert(THINGSPEAK_CA_CERT);
  HTTPClient https;
  https.setConnectTimeout(6000);
  https.setTimeout(6000);
  if (!https.begin(cloudClient, url)) return;
  const int httpCode = https.GET();
  const String response = httpCode == HTTP_CODE_OK ? https.getString() : String();
  https.end();
  if (httpCode != HTTP_CODE_OK) return;

  StaticJsonDocument<768> document;
  if (deserializeJson(document, response)) return;
  const long entryId = document["entry_id"] | 0L;
  const int requested = document["field1"] | 0;
  if (entryId <= 0) return;
  lastControlResponseMs = millis();

  // Ignore the last stored command after boot. A restart always leaves the
  // MOSFET off; a new app command must arrive after this baseline is read.
  if (!commandBaselineReady) {
    lastCommandEntryId = entryId;
    commandBaselineReady = true;
    Serial.println("ThingSpeak command channel ready; output remains off.");
    return;
  }
  if (entryId <= lastCommandEntryId) return;
  lastCommandEntryId = entryId;
  queueRemoteCommand(requested != 0 ? 1 : 0);
}

void pushCloudTelemetry() {
  if (WiFi.status() != WL_CONNECTED || !cloudClockReady()) return;
  const CloudSnapshot snapshot = takeCloudSnapshot();
  String body = "api_key=" + urlEncode(String(THINGSPEAK_TELEMETRY_WRITE_API_KEY));
  if (snapshot.measurementValid) {
    body += "&field1=" + String(snapshot.voltageV, 3);
    body += "&field2=" + String(snapshot.currentA, 3);
    body += "&field3=" + String(snapshot.powerW, 3);
    body += "&field4=" + String(snapshot.temperatureC, 2);
  }
  body += "&field5=" + String(snapshot.charging ? 1 : 0);
  body += "&field6=" + String(snapshot.state);
  body += "&field7=" + String(snapshot.outputEnabled ? 1 : 0);
  body += "&field8=" + String(snapshot.rssi);
  body += "&status=" + urlEncode(String(snapshot.alert));

  cloudClient.setCACert(THINGSPEAK_CA_CERT);
  HTTPClient https;
  https.setConnectTimeout(7000);
  https.setTimeout(7000);
  if (!https.begin(cloudClient, "https://api.thingspeak.com/update.json")) return;
  https.addHeader("Content-Type", "application/x-www-form-urlencoded");
  const int httpCode = https.POST(body);
  const String response = https.getString();
  https.end();

  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("ThingSpeak telemetry request failed: HTTP %d\n", httpCode);
    return;
  }
  StaticJsonDocument<512> result;
  const long entryId = deserializeJson(result, response) ? response.toInt() : (result["entry_id"] | 0L);
  if (entryId <= 0) Serial.println("ThingSpeak did not accept telemetry; check channel key and write interval.");
  else Serial.printf("ThingSpeak telemetry updated (entry %ld).\n", entryId);
}

void monitorControlLink() {
  if (!remoteOutputRequested || lastControlResponseMs == 0) return;
  if (millis() - lastControlResponseMs > CONTROL_LINK_TIMEOUT_MS) {
    remoteOutputRequested = false;
    setLoadEnabled(false);
    strncpy(lastAlert, "Cloud control link lost; output disconnected", sizeof(lastAlert) - 1);
    lastAlert[sizeof(lastAlert) - 1] = '\0';
    writeLocalHistory("CONTROL_LINK_LOST", lastAlert);
    cloudEvent("safety_warning", lastAlert);
  }
}

void cloudTask(void* argument) {
  (void)argument;
  for (;;) {
    if (WiFi.status() == WL_CONNECTED && cloudClockReady()) {
      const uint32_t now = millis();
      if (lastCloudWriteMs == 0 || now - lastCloudWriteMs >= CLOUD_INTERVAL_MS) {
        lastCloudWriteMs = now;
        pushCloudTelemetry();
      }
      if (now - lastControlPollMs >= CONTROL_POLL_INTERVAL_MS) {
        lastControlPollMs = now;
        pollCloudCommand();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void updateOutputs() {
  const uint32_t now = millis();
  const bool faultBlink = faultLatched && ((now / 200) % 2 == 0);
  const bool warningBlink = warningActive && ((now / 700) % 2 == 0);
  digitalWrite(PIN_STATUS_LED, faultLatched ? faultBlink : (warningActive ? warningBlink : (loadEnabled ? HIGH : LOW)));
  const bool buzzerOn = faultLatched ? ((now % 1000) < 180)
                                      : (warningActive && (now % 2500) < 100);
  digitalWrite(PIN_BUZZER, buzzerOn ? HIGH : LOW);
#if ENABLE_OLED
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.print("Smart Charge: "); display.println(stateName(deviceState));
  display.print("V: "); display.print(readings.voltageV, 2); display.print(" A: "); display.println(readings.currentA, 3);
  display.print("P: "); display.print(readings.powerW, 2); display.println(" W");
  display.print("Temp: "); display.print(readings.temperatureC, 1); display.println(" C");
  display.print(loadEnabled ? "Load: ON" : "Load: CUT OFF");
  display.display();
#endif
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_MOSFET, OUTPUT);
  digitalWrite(PIN_MOSFET, MOSFET_OFF_LEVEL); // fail-safe: disconnect load before init
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_RESET_BUTTON, INPUT_PULLUP);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_STATUS_LED, LOW);

  historyReady = LittleFS.begin(false);
  if (!historyReady) {
    Serial.println("LittleFS mount failed; trying to format the history partition.");
    historyReady = LittleFS.begin(true); // Formatting can erase previous local history.
  }
  if (historyReady && !LittleFS.exists(HISTORY_PATH)) {
    File file = LittleFS.open(HISTORY_PATH, FILE_WRITE);
    if (file) {
      file.println("uptime_ms,event,voltage_V,current_A,power_W,temp_C,detail");
      file.close();
    }
  }

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  const bool inaReady = ina219.begin();
  temperatureSensor.begin();
  temperatureSensor.setResolution(12);
  temperatureSensor.setWaitForConversion(false);
  const bool tempReady = temperatureSensor.getDeviceCount() > 0;
  hardwareReady = inaReady && tempReady;

#if ENABLE_OLED
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Smart Charging Station");
    display.display();
  }
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();

  temperatureSensor.requestTemperatures();
  if (!hardwareReady) latchFault(FAULT_SENSOR, "INA219 or DS18B20 not detected; load disconnected");
  publishCloudSnapshot();
  xTaskCreatePinnedToCore(cloudTask, "ThingSpeakCloud", 8192, nullptr, 1, nullptr, 0);
  Serial.println("Smart Charging Station ready. Output stays off until a fresh app command passes local safety checks.");
}

void loop() {
  maintainNetwork();
  updateButton();
  const uint32_t now = millis();
  if (now - lastSensorMs >= SENSOR_INTERVAL_MS) {
    lastSensorMs = now;
    if (hardwareReady) readSensors();
    else evaluateSafety();
  }
  const int remoteCommand = takeRemoteCommand();
  if (remoteCommand >= 0) applyRemoteCommand(remoteCommand != 0);
  monitorControlLink();
  publishCloudSnapshot();
  updateOutputs();
}
