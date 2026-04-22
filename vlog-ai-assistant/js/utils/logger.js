/* logger.js - Logging utility with debug support */

const Logger = {
    info(message, data = null) {
        if (CONSTANTS && CONSTANTS.LOG_LEVEL !== 'error') {
            console.log(\[INFO] \\, data || '');
        }
    },
    
    debug(message, data = null) {
        if (CONSTANTS && (CONSTANTS.DEBUG || CONSTANTS.LOG_LEVEL === 'debug')) {
            console.log(\[DEBUG] \\, data || '');
        }
    },
    
    warn(message, data = null) {
        console.warn(\[WARN] \\, data || '');
    },
    
    error(message, error = null) {
        console.error(\[ERROR] \\, error || '');
    },
    
    group(label) {
        console.group(label);
    },
    
    groupEnd() {
        console.groupEnd();
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}
