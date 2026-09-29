constexpr uint8_t LED_PIN = LED_BUILTIN;
constexpr unsigned long BLINK_INTERVAL_MS = 1000;

bool ledState = false;
unsigned long lastToggle = 0;

void setLed(bool enabled) {
  ledState = enabled;
  digitalWrite(LED_PIN, enabled ? HIGH : LOW);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  setLed(false);

  Serial.begin(115200);
  Serial.println("AMB82-MINI ready. Send 1 to turn the LED on, 0 to turn it off.");
}

void loop() {
  if (Serial.available() > 0) {
    const char command = Serial.read();

    if (command == '1') {
      setLed(true);
      Serial.println("LED ON");
    } else if (command == '0') {
      setLed(false);
      Serial.println("LED OFF");
    }

    lastToggle = millis();
  }

  if (millis() - lastToggle >= BLINK_INTERVAL_MS) {
    lastToggle = millis();
    setLed(!ledState);
    Serial.println(ledState ? "LED ON (auto)" : "LED OFF (auto)");
  }
}

