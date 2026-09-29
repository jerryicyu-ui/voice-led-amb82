#include "StreamIO.h"
#include "AudioStream.h"
#include "NNAudioClassification.h"

// YAMNet audio classification requires 16 kHz mono audio.
AudioSetting configA(16000, 1, USE_AUDIO_AMIC);
Audio audio;
NNAudioClassification audioNN;
StreamIO audioStreamerNN(1, 1);

constexpr uint8_t LED_PIN = LED_BUILTIN;
constexpr int SCORE_THRESHOLD = 50;
constexpr unsigned long LED_ON_TIME_MS = 3000;

volatile bool alarmDetected = false;
bool ledOn = false;
unsigned long ledStartTime = 0;

const char* alarmClassName(int classId)
{
    switch (classId) {
        case 304:
            return "Car alarm";
        case 382:
            return "Alarm";
        case 389:
            return "Alarm clock";
        case 390:
            return "Siren";
        case 393:
            return "Smoke detector, smoke alarm";
        case 394:
            return "Fire alarm";
        default:
            return nullptr;
    }
}

void ACPostProcess(std::vector<AudioClassificationResult> results)
{
    const int count = audioNN.getResultCount();

    for (int i = 0; i < count; i++) {
        AudioClassificationResult audioItem = results[i];
        const int classId = static_cast<int>(audioItem.classID());
        const int score = audioItem.score();
        const char* className = alarmClassName(classId);

        if (className == nullptr) {
            continue;
        }

        printf("class %d, score: %d, name: %s\r\n", classId, score, className);

        if (score >= SCORE_THRESHOLD) {
            printf(">>> ALARM DETECTED: %s (score %d) <<<\r\n", className, score);
            alarmDetected = true;
        }
    }
}

void setup()
{
    Serial.begin(115200);

    audio.configAudio(configA);
    audio.begin();

    audioNN.configAudio(configA);
    audioNN.setResultCallback(ACPostProcess);
    // Keep modelSelect on one line: Realtek's prebuild scanner parses this textually.
    audioNN.modelSelect(AUDIO_CLASSIFICATION, NA_MODEL, NA_MODEL, NA_MODEL, DEFAULT_YAMNET);
    audioNN.begin();

    audioStreamerNN.registerInput(audio);
    audioStreamerNN.registerOutput(audioNN);
    if (audioStreamerNN.begin() != 0) {
        printf("StreamIO link start failed\r\n");
    }

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    printf("================================\r\n");
    printf("Alarm Detection Ready\r\n");
    printf("Score threshold = %d\r\n", SCORE_THRESHOLD);
    printf("================================\r\n");
}

void loop()
{
    if (alarmDetected) {
        alarmDetected = false;
        digitalWrite(LED_PIN, HIGH);
        ledOn = true;
        ledStartTime = millis();
        printf("LED ON\r\n");
    }

    if (ledOn && (millis() - ledStartTime >= LED_ON_TIME_MS)) {
        digitalWrite(LED_PIN, LOW);
        ledOn = false;
        printf("LED OFF\r\n");
    }

    delay(10);
}
