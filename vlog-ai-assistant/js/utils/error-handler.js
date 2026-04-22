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
        
        if (error?.status === 429) {
            return {
                type: 'rate_limit',
                userMessage: 'API rate limit reached. Please try again in a moment.',
                code: 'API_RATE_LIMIT',
                retryAfter: error.retryAfter,
            };
        }
        
        if (error?.status === 401 || error?.status === 403) {
            return {
                type: 'auth_error',
                userMessage: 'Invalid API key. Please check your settings.',
                code: 'API_AUTH_ERROR',
            };
        }
        
        if (error?.status === 400) {
            return {
                type: 'validation_error',
                userMessage: 'Invalid request. Please check your settings.',
                code: 'API_VALIDATION_ERROR',
            };
        }
        
        if (error?.message?.includes('timeout')) {
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
        Logger.warn(\Validation error in \: \\);
        
        return {
            type: 'validation',
            userMessage: \Invalid value for \\,
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
        Logger.error(\[\] \\);
        if (error instanceof Error && error.stack) {
            Logger.debug(error.stack);
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorHandler;
}
