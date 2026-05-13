/* validators.js - Input validation and error checking */

const Validators = {
    /**
     * Check if an active sequence exists in Premiere Pro
     * @returns {boolean}
     */
    hasActiveSequence() {
        try {
            return !!PremiereAPI.getActiveSequence();
        } catch (e) {
            Logger.error('Error checking active sequence', e);
            return false;
        }
    },
    
    /**
     * Validate silence threshold value
     * @param {number} value - The threshold in dB
     * @returns {boolean}
     */
    isValidSilenceThreshold(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= -80 && num <= -10;
    },
    
    /**
     * Validate minimum silence duration
     * @param {number} value - The duration in milliseconds
     * @returns {boolean}
     */
    isValidMinDuration(value) {
        const num = parseInt(value, 10);
        return !isNaN(num) && num >= 100 && num <= 2000;
    },
    
    /**
     * Validate confidence threshold (0-1)
     * @param {number} value - The confidence value
     * @returns {boolean}
     */
    isValidConfidence(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= 0.5 && num <= 1;
    },
    
    /**
     * Validate API key format (basic check)
     * @param {string} key - The API key
     * @returns {boolean}
     */
    isValidApiKey(key) {
        return key && key.length > 0 && key.length < 500;
    },
    
    /**
     * Validate project metadata structure
     * @param {object} metadata - The metadata object
     * @returns {boolean}
     */
    isValidProjectMetadata(metadata) {
        return metadata && 
               typeof metadata === 'object' &&
               metadata.sequenceName &&
               Array.isArray(metadata.clips);
    },
    
    /**
     * Validate API response structure
     * @param {object} response - The API response
     * @returns {boolean}
     */
    isValidApiResponse(response) {
        return response && typeof response === 'object' && response.success !== false;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Validators;
}
