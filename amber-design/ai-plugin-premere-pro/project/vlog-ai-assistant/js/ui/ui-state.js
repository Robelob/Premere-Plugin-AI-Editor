/* ui-state.js - UI state management */

const UIState = {
    // Current state
    state: {
        status: 'ready',
        statusMessage: 'READY',
        isLoading: false,
        results: null,
        error: null,
        debugEnabled: false,
        selectedSequenceId: null,
        settings: {
            silenceThreshold: -50,
            minSilenceDuration: 500,
            confidenceThreshold: 0.7,
            apiKey: '',
        },
    },
    
    /**
     * Update UI state
     * @param {string} key - State key
     * @param {*} value - New value
     */
    setState(key, value) {
        this.state[key] = value;
        Logger.debug('State updated: ' + key + ' = ' + JSON.stringify(value));
    },
    
    /**
     * Get current state value
     * @param {string} key - State key
     * @returns {*}
     */
    getState(key) {
        return this.state[key];
    },
    
    /**
     * Set status and message
     * @param {string} status - Status type
     * @param {string} message - Message to display
     */
    setStatus(status, message) {
        this.state.status = status;
        this.state.statusMessage = message;
        Logger.info('Status: ' + status + ' - ' + message);
    },
    
    /**
     * Set loading state
     * @param {boolean} isLoading
     */
    setLoading(isLoading) {
        this.state.isLoading = isLoading;
    },
    
    /**
     * Set results from analysis
     * @param {object} results
     */
    setResults(results) {
        this.state.results = results;
        this.state.status = 'success';
    },
    
    /**
     * Set error
     * @param {string|Error} error
     */
    setError(error) {
        this.state.error = error instanceof Error ? error.message : error;
        this.state.status = 'error';
    },
    
    /**
     * Update settings
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     */
    updateSetting(key, value) {
        if (this.state.settings.hasOwnProperty(key)) {
            this.state.settings[key] = value;
            Logger.debug('Setting updated: ' + key + ' = ' + JSON.stringify(value));
        }
    },
    
    /**
     * Get all settings
     * @returns {object}
     */
    getSettings() {
        return { ...this.state.settings };
    },
    
    /**
     * Reset state to initial
     */
    reset() {
        this.state.results = null;
        this.state.error = null;
        this.state.status = 'ready';
        this.state.statusMessage = 'Ready';
        this.state.isLoading = false;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIState;
}
