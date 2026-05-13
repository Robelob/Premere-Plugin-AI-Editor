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
    
    // API Configuration
    API_TIMEOUT: 30000, // milliseconds
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // milliseconds
    
    // Silence Detection
    SILENCE: {
        DEFAULT_THRESHOLD: -50, // dB
        MIN_DURATION: 500, // milliseconds
        MAX_DURATION: 10000,
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
    },
    
    // Plugin Version
    VERSION: '0.1.0',
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
}
