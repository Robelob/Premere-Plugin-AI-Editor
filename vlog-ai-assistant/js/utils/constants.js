/* constants.js - Shared constants and configuration */

const CONSTANTS = {
    // Feature Toggles
    FEATURES: {
        SILENCE_REMOVAL: true,
        BROLL_DETECTION: true,
        AUTO_CAPTIONING: false,
        UNDO_REDO: false,
        BATCH_OPERATIONS: true,
    },

    // Debug Settings
    DEBUG: false,
    LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'

    // AI Provider ('gemini' | 'openai' | 'anthropic' | 'ollama' | 'openai-compatible')
    AI_PROVIDER: 'openai-compatible',   // uses Groq key already saved in Settings
    AI_MODEL: 'llama-3.3-70b-versatile', // fast Groq model for clip classification
    OLLAMA_URL: 'https://api.groq.com/openai/v1',

    // Layer 2 — Whisper transcription
    WHISPER_PROVIDER:   'groq',                      // 'groq' | 'openai' | 'local-whisper'
    WHISPER_API_KEY:    '',                           // user fills in Settings (same Groq key)
    WHISPER_LOCAL_URL:  'http://localhost:8080',      // local whisper.cpp server

    // API Configuration
    API_TIMEOUT: 60000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,

    // Timeline — ticks (Premiere Pro internal unit)
    // 254016000000 ticks = exactly 1 second at any frame rate
    TICKS_PER_SECOND: 254016000000,
    // 0.15s breath padding shrunk from each side of a DELETE segment
    PADDING_SECONDS: 0.15,
    PADDING_TICKS: 38102400000,
    // Constant Power crossfade applied to every resulting edit point
    CROSSFADE_FRAMES: 2,

    // Edit thresholds
    MIN_SILENCE_SECONDS: 1.2,  // AI must not suggest cuts shorter than this
    MIN_CONFIDENCE: 0.75,      // discard AI suggestions below this score

    // UI state machine
    STATES: {
        READY:          'ready',
        ANALYZING:      'analyzing',
        MARKERS_PLACED: 'markers_placed',
        COMMITTING:     'committing',
        COMMITTED:      'committed',
        ERROR:          'error',
    },

    // CEP bridge IPC
    BRIDGE_TIMEOUT_MS: 60000,  // give up waiting for bridge response after 60s (ripple delete can be slow)
    BRIDGE_POLL_MS: 200,       // how often the CEP side polls the temp dir

    // Silence Detection
    SILENCE: {
        DEFAULT_THRESHOLD: -50, // dB
        MIN_DURATION: 500,
        MAX_DURATION: 10000,
    },

    // Vision AI — Layer 2b (Pass 1: Ollama vision description)
    VISION_MODEL: 'llava:7b',                  // exact Ollama tag; run 'ollama list' to confirm
    VISION_KEYFRAME_INTERVAL_SEC: 15,         // one frame every N seconds for timeline keyframe analysis
    // Pass 2 classification uses AIService (existing AI_PROVIDER / AI_MODEL setting)
    BROLL_BINS: {
        'talking-head':     '🎙 Talking Head',
        'aerial-drone':     '🚁 Aerial & Drone',
        'indoor-broll':     '🏛 Indoor B-roll',
        'outdoor-broll':    '🌿 Outdoor B-roll',
        'landscape':        '🌊 Landscape',
        'product-closeup':  '📦 Product',
        'screen-recording': '💻 Screen Recording',
        'other':            '🏷 Other',
    },

    // B-Roll Detection
    BROLL: {
        DEFAULT_CONFIDENCE: 0.7,
        MIN_CONFIDENCE: 0.5,
        MAX_CONFIDENCE: 0.95,
    },

    // UI Messages
    MESSAGES: {
        READY: 'Ready',
        ANALYZING: 'Analyzing your project...',
        NO_SEQUENCE: 'No active sequence. Please open a sequence in Premiere Pro.',
        API_ERROR: 'API error. Please check your settings.',
        SUCCESS: 'Operation completed successfully.',
        BRIDGE_MISSING: 'CEP Bridge not found. Please ensure the bridge panel is installed. See README for instructions.',
    },

    // Plugin name and version
    NAME: 'Ambar',
    VERSION: '0.1.0',
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
}
