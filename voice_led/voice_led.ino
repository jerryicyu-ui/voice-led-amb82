/*
 * 語音控制 LED 系統 — AMB82-MINI 韌體
 *
 * 板卡：Realtek AMB82-MINI (AmebaPro2 / RTL8735B)
 * LED：LED_B = AMB_D23（藍，左邊）、LED_G = AMB_D24（綠，右邊），HIGH = 亮、LOW = 滅
 *
 * 通訊：USB 序列埠 115200。每行一個文字指令（例如 "BLUE_ON\n"），
 *       板子回傳一行以 '{' 開頭的 JSON 狀態，網頁只讀取這種行，其他行是 log。
 *
 * 指令：BLUE_ON BLUE_OFF GREEN_ON GREEN_OFF ALL_ON ALL_OFF
 *       BLINK_BLUE BLINK_GREEN BLINK_ALL（閃爍三次後恢復原狀態）  STATUS
 * 未知指令一律回 ok:false，且不改變任何 LED 狀態。
 */

constexpr uint8_t PIN_BLUE = LED_B;
constexpr uint8_t PIN_GREEN = LED_G;
constexpr int BLINK_TIMES = 3;
constexpr unsigned long BLINK_HALF_PERIOD_MS = 250;
constexpr unsigned int MAX_COMMAND_LENGTH = 32;

// 「邏輯狀態」：使用者要求的亮滅。閃爍期間實際腳位會暫時不同，結束後恢復到此狀態。
bool blueOn = false;
bool greenOn = false;

// 閃爍狀態機（非阻塞，閃爍中仍可接收指令）
bool blinkBlue = false;
bool blinkGreen = false;
int blinkStepsLeft = 0;    // 每次亮或滅算一步：先滅一拍，再亮滅三次 = 7 步
unsigned long lastBlinkStep = 0;

unsigned long commandCount = 0;
String serialLine = "";

void applyOutputs()
{
    digitalWrite(PIN_BLUE, blueOn ? HIGH : LOW);
    digitalWrite(PIN_GREEN, greenOn ? HIGH : LOW);
}

void startBlink(bool blue, bool green)
{
    blinkBlue = blue;
    blinkGreen = green;
    // 多一個「先滅」的步驟：原本就亮著時，第一次亮才看得出來（實測只看到兩次閃爍而修正）
    blinkStepsLeft = BLINK_TIMES * 2 + 1;
    lastBlinkStep = millis() - BLINK_HALF_PERIOD_MS;    // 立即執行第一步
}

void updateBlink()
{
    if (blinkStepsLeft <= 0 || millis() - lastBlinkStep < BLINK_HALF_PERIOD_MS) {
        return;
    }
    lastBlinkStep = millis();
    // 奇數步（7,5,3,1）滅、偶數步（6,4,2）亮
    const bool phaseOn = (blinkStepsLeft % 2) == 0;
    if (blinkBlue) {
        digitalWrite(PIN_BLUE, phaseOn ? HIGH : LOW);
    }
    if (blinkGreen) {
        digitalWrite(PIN_GREEN, phaseOn ? HIGH : LOW);
    }
    blinkStepsLeft--;
    if (blinkStepsLeft == 0) {
        applyOutputs();    // 恢復閃爍前的狀態
    }
}

String statusJson(bool ok, const String &cmd, const String &message)
{
    String json = "{\"ok\":";
    json += ok ? "true" : "false";
    json += ",\"cmd\":\"" + cmd + "\"";
    json += ",\"msg\":\"" + message + "\"";
    json += ",\"blue\":";
    json += blueOn ? "1" : "0";
    json += ",\"green\":";
    json += greenOn ? "1" : "0";
    json += ",\"blinking\":";
    json += blinkStepsLeft > 0 ? "true" : "false";
    json += ",\"count\":" + String(commandCount);
    json += ",\"uptime\":" + String(millis() / 1000);
    json += ",\"board\":\"AMB82-MINI\"}";
    return json;
}

// 只有白名單內的指令會改變 LED
String handleCommand(String cmd)
{
    cmd.trim();
    cmd.toUpperCase();

    if (cmd == "STATUS") {
        return statusJson(true, cmd, "status");
    }

    bool known = true;
    if (cmd == "BLUE_ON") {
        blueOn = true;
    } else if (cmd == "BLUE_OFF") {
        blueOn = false;
    } else if (cmd == "GREEN_ON") {
        greenOn = true;
    } else if (cmd == "GREEN_OFF") {
        greenOn = false;
    } else if (cmd == "ALL_ON") {
        blueOn = true;
        greenOn = true;
    } else if (cmd == "ALL_OFF") {
        blueOn = false;
        greenOn = false;
    } else if (cmd == "BLINK_BLUE") {
        startBlink(true, false);
    } else if (cmd == "BLINK_GREEN") {
        startBlink(false, true);
    } else if (cmd == "BLINK_ALL") {
        startBlink(true, true);
    } else {
        known = false;
    }

    if (!known) {
        Serial.print("[CMD] rejected: ");
        Serial.println(cmd);
        return statusJson(false, cmd, "unknown command");
    }

    commandCount++;
    if (!cmd.startsWith("BLINK")) {
        blinkStepsLeft = 0;    // 開關指令會中斷閃爍
        applyOutputs();
    }
    Serial.print("[CMD] ");
    Serial.print(cmd);
    Serial.print(" -> blue=");
    Serial.print(blueOn);
    Serial.print(" green=");
    Serial.println(greenOn);
    return statusJson(true, cmd, "done");
}

void handleSerial()
{
    while (Serial.available() > 0) {
        const char c = Serial.read();
        if (c == '\n' || c == '\r') {
            if (serialLine.length() > 0) {
                Serial.println(handleCommand(serialLine));
                serialLine = "";
            }
        } else if (serialLine.length() < MAX_COMMAND_LENGTH) {
            serialLine += c;
        }
    }
}

void setup()
{
    Serial.begin(115200);
    pinMode(PIN_BLUE, OUTPUT);
    pinMode(PIN_GREEN, OUTPUT);
    applyOutputs();    // 開機預設全滅

    Serial.println("==== AMB82-MINI Voice LED (USB serial) ====");
    Serial.println("LED_B(D23)=blue/left, LED_G(D24)=green/right, HIGH=on");
    Serial.println("Commands: BLUE_ON GREEN_ON ... STATUS");
}

void loop()
{
    handleSerial();
    updateBlink();
    delay(2);
}
