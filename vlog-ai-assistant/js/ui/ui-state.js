/* ui-state.js - UI state management */

// DOM config for each named state in CONSTANTS.STATES
const _STATE_CONFIG = {
    ready: {
        pillClass:   'status-ready',
        label:       'READY',
        isLoading:   false,
        analyzeEnabled: true,
        commitEnabled:  false,
    },
    analyzing: {
        pillClass:   'status-busy',
        label:       'ANALYZING',
        isLoading:   true,
        analyzeEnabled: false,
        commitEnabled:  false,
    },
    markers_placed: {
        pillClass:   'status-review',
        label:       'REVIEW',
        isLoading:   false,
        analyzeEnabled: true,
        commitEnabled:  true,   // ← Commit becomes available after Analyze
    },
    committing: {
        pillClass:   'status-busy',
        label:       'COMMITTING',
        isLoading:   true,
        analyzeEnabled: false,
        commitEnabled:  false,
    },
    committed: {
        pillClass:   'status-done',
        label:       'DONE',
        isLoading:   false,
        analyzeEnabled: true,
        commitEnabled:  false,
    },
    error: {
        pillClass:   'status-error',
        label:       'ERROR',
        isLoading:   false,
        analyzeEnabled: true,
        commitEnabled:  false,
    },
};

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
            silenceThreshold:    -50,
            minSilenceDuration:  500,
            confidenceThreshold: 0.7,
            provider: 'ollama',
            apiKey:   '',
            model:    '',
            baseUrl:  'http://localhost:11434/v1',
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
        this.state.settings[key] = value;
        Logger.debug('Setting updated: ' + key + ' = ' + JSON.stringify(value));
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
        this.state.error   = null;
        this.state.status  = 'ready';
        this.state.statusMessage = 'Ready';
        this.state.isLoading     = false;
        this._applyToDom('ready');
    },

    /**
     * Drive the two-step state machine.
     * Accepts any value from CONSTANTS.STATES and updates the DOM immediately.
     * Called by TimelineEditor and UIController.
     */
    set(stateName) {
        const cfg = _STATE_CONFIG[stateName];
        if (!cfg) {
            Logger.warn('UIState.set: unknown state "' + stateName + '"');
            return;
        }
        this.state.status      = stateName;
        this.state.statusMessage = cfg.label;
        this.state.isLoading   = cfg.isLoading;
        Logger.info('UIState → ' + stateName);
        this._applyToDom(stateName);
    },

    /**
     * Update DOM elements to reflect the new state.
     * Uses getElementById with null-guards so it's safe to call before
     * ui-controller wires up all elements.
     */
    _applyToDom(stateName) {
        const cfg = _STATE_CONFIG[stateName] || _STATE_CONFIG.ready;

        // Status pill
        var pill = document.getElementById('statusIndicator');
        if (pill) {
            // Swap out any existing status-* class
            pill.className = pill.className.replace(/\bstatus-\S+/g, '').trim();
            pill.classList.add('status-pill', cfg.pillClass);
        }
        var pillText = document.getElementById('statusText');
        if (pillText) pillText.textContent = cfg.label;

        // Loading overlay
        var overlay = document.getElementById('loadingIndicator');
        if (overlay) overlay.style.display = cfg.isLoading ? 'flex' : 'none';

        // Analyze button (always present in HTML)
        var analyzeBtn = document.getElementById('analyzeBtn');
        if (analyzeBtn) analyzeBtn.disabled = !cfg.analyzeEnabled;

        // Commit button (added by UIController — may not exist yet)
        var commitBtn = document.getElementById('commitEditsBtn');
        if (commitBtn) commitBtn.disabled = !cfg.commitEnabled;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIState;
}
