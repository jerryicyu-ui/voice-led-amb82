#include "StreamIO.h"
#include "AudioStream.h"
#include "NNAudioClassification.h"

constexpr uint8_t LED_PIN = LED_BUILTIN;
constexpr int SCORE_THRESHOLD = 50;
constexpr unsigned long CLAP_COOLDOWN_MS = 1000;

AudioSetting configA(16000, 1, USE_AUDIO_AMIC);
Audio audio;
NNAudioClassification audioNN;
StreamIO audioStreamerNN(1, 1);

volatile bool clapDetected = false;
volatile unsigned long lastClapTime = 0;
bool ledState = false;

const char* clapClassName(int classId)
{
    switch (classId) {
        case 58:
            return "Clapping";
        case 62:
            return "Applause";
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
        const char* className = clapClassName(classId);

        if (className == nullptr) {
            continue;
        }

        printf("class %d, score: %d, name: %s\r\n", classId, score, className);

        if (score >= SCORE_THRESHOLD) {
            const unsigned long now = millis();
            if (now - lastClapTime >= CLAP_COOLDOWN_MS) {
                clapDetected = true;
                lastClapTime = now;
                printf("*** CLAP DETECTED ***\r\n");
            }
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
    printf("Clap Detection Ready\r\n");
    printf("Clap once to toggle the LED\r\n");
    printf("Score threshold = %d\r\n", SCORE_THRESHOLD);
    printf("================================\r\n");
}

void loop()
{
    if (clapDetected) {
        clapDetected = false;
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState ? HIGH : LOW);
        printf(ledState ? "LED ON\r\n" : "LED OFF\r\n");
    }

    delay(10);
}

