/* error-handler.js - Centralized error handling and user messaging */

const ErrorHandler = {
    /**
     * Handle Premiere API errors
     * @param {Error|string} error
     * @returns {object} Standardized error object
     */
    handlePremiereError(error) {
        const msg = error instanceof Error ? error.message : String(error);
        Logger.error('Premiere error:', msg);
        
        if (msg.includes('activeSequence')) {
            return {
                type: 'no_sequence',
                userMessage: CONSTANTS.MESSAGES.NO_SEQUENCE,
                code: 'PREMIERE_NO_SEQUENCE',
            };
        }
        
        if (msg.includes('track') || msg.includes('locked')) {
            return {
                type: 'track_error',
                userMessage: 'Cannot modify locked tracks or unavailable tracks',
                code: 'PREMIERE_TRACK_ERROR',
            };
        }
        
        return {
            type: 'unknown',
            userMessage: 'Premiere Pro error: ' + msg,
            code: 'PREMIERE_UNKNOWN_ERROR',
        };
    },
    
    /**
     * Handle API errors
     * @param {Error|object} error
     * @returns {object} Standardized error object
     */
    handleAPIError(error) {
        Logger.error('API error:', error);
        
        var msg = (error && error.message) ? error.message : String(error || '');
        var status = (error && error.status) ? error.status : 0;
        if (!status) {
            var m = msg.match(/\b(4\d\d|5\d\d)\b/);
            if (m) status = parseInt(m[1], 10);
        }

        if (status === 429 || msg.indexOf('429') !== -1) {
            return {
                type: 'rate_limit',
                userMessage: 'Rate limit reached — wait 60 seconds and try again. (Free tier: 15 req/min)',
                code: 'API_RATE_LIMIT',
            };
        }

        if (status === 401 || status === 403 || msg.indexOf('401') !== -1 || msg.indexOf('403') !== -1) {
            return {
                type: 'auth_error',
                userMessage: 'Invalid API key. Check the key in the Config tab.',
                code: 'API_AUTH_ERROR',
            };
        }

        if (status === 400 || msg.indexOf('400') !== -1) {
            return {
                type: 'validation_error',
                userMessage: 'Invalid request sent to Gemini. Check your settings.',
                code: 'API_VALIDATION_ERROR',
            };
        }
        
        if (error && error.message && error.message.includes('timeout')) {
            return {
                type: 'timeout',
                userMessage: 'Request timeout. Please try again.',
                code: 'API_TIMEOUT',
            };
        }
        
        return {
            type: 'unknown',
            userMessage: CONSTANTS.MESSAGES.API_ERROR,
            code: 'API_UNKNOWN_ERROR',
        };
    },
    
    /**
     * Handle validation errors
     * @param {string} field - Field name
     * @param {*} value - Invalid value
     * @returns {object}
     */
    handleValidationError(field, value) {
        Logger.warn('Validation error in ' + field + ': ' + value);
        
        return {
            type: 'validation',
            userMessage: 'Invalid value for ' + field,
            code: 'VALIDATION_ERROR',
            field,
        };
    },
    
    /**
     * Show user-friendly error message
     * @param {object} error - Error object
     */
    showUserError(error) {
        UIController.showError(error.userMessage);
        Logger.warn('User error shown:', error.code);
    },
    
    /**
     * Log error for debugging
     * @param {string} context - Where error occurred
     * @param {Error|string} error
     */
    logError(context, error) {
        Logger.error('[' + context + '] ' + (error instanceof Error ? error.message : String(error)));
        if (error instanceof Error && error.stack) {
            Logger.debug(error.stack);
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorHandler;
}
