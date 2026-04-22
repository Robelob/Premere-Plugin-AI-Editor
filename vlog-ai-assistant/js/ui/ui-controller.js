/* ui-controller.js - UI event handlers and rendering */

const UIController = {
    /**
     * Initialize UI event listeners
     */
    init() {
        Logger.info('Initializing UI Controller');
        
        // Tab change handlers would go here if needed
        // Button handlers are defined inline in HTML via onclick
        
        // Restore saved settings
        this.restoreSettings();
        
        // Set initial status
        this.updateStatus('ready', 'Ready to analyze');
    },
    
    /**
     * Handle silence removal analysis
     */
    analyzeSilence() {
        Logger.info('Starting silence analysis');
        
        // Validate active sequence
        if (!Validators.hasActiveSequence()) {
            this.showError(CONSTANTS.MESSAGES.NO_SEQUENCE);
            return;
        }
        
        // Get settings
        const threshold = document.getElementById('silenceThreshold')?.value || -50;
        const duration = document.getElementById('minSilenceDuration')?.value || 500;
        
        // Validate settings
        if (!Validators.isValidSilenceThreshold(threshold)) {
            this.showError('Invalid silence threshold');
            return;
        }
        
        if (!Validators.isValidMinDuration(duration)) {
            this.showError('Invalid minimum duration');
            return;
        }
        
        // Show loading state
        this.showLoading('Analyzing silence...');
        
        // Update settings in state
        UIState.updateSetting('silenceThreshold', parseFloat(threshold));
        UIState.updateSetting('minSilenceDuration', parseInt(duration, 10));
        
        // Simulate API call (replace with actual Gemini API call later)
        setTimeout(() => {
            Logger.info('Silence analysis complete');
            const mockResults = {
                segments: [
                    { start: 5000, end: 5800, confidence: 0.95 },
                    { start: 12000, end: 12500, confidence: 0.88 },
                ],
                totalSilence: '14.3 seconds',
                estimatedSavings: '12.5%',
            };
            this.displayResults(mockResults);
            this.hideLoading();
        }, 2000);
    },
    
    /**
     * Handle B-roll detection
     */
    detectBroll() {
        Logger.info('Starting B-roll detection');
        
        if (!Validators.hasActiveSequence()) {
            this.showError(CONSTANTS.MESSAGES.NO_SEQUENCE);
            return;
        }
        
        const confidence = document.getElementById('confidenceThreshold')?.value || 0.7;
        
        if (!Validators.isValidConfidence(confidence)) {
            this.showError('Invalid confidence threshold');
            return;
        }
        
        this.showLoading('Detecting B-roll opportunities...');
        UIState.updateSetting('confidenceThreshold', parseFloat(confidence));
        
        // Simulate API call
        setTimeout(() => {
            Logger.info('B-roll detection complete');
            const mockResults = {
                opportunities: [
                    { timestamp: 15000, suggestion: 'Transition scene', confidence: 0.92 },
                    { timestamp: 32500, suggestion: 'Emphasis moment', confidence: 0.87 },
                ],
                totalOpportunities: 2,
            };
            this.displayResults(mockResults);
            this.hideLoading();
        }, 2000);
    },
    
    /**
     * Apply edits to timeline
     */
    applyEdits() {
        Logger.info('Applying edits...');
        this.showLoading('Applying edits to timeline...');
        
        // Replace with actual edit logic in timeline-editor.js
        setTimeout(() => {
            this.hideLoading();
            this.updateStatus('success', 'Edits applied successfully');
            alert('Edits applied to your timeline!');
        }, 1500);
    },
    
    /**
     * Discard results without applying
     */
    discardResults() {
        Logger.info('Discarding results');
        UIState.reset();
        this.hideResults();
        this.updateStatus('ready', 'Ready to analyze');
    },
    
    /**
     * Toggle debug mode
     */
    toggleDebugMode() {
        const debugCheckbox = document.getElementById('enableDebug');
        const isEnabled = debugCheckbox?.checked || false;
        UIState.setState('debugEnabled', isEnabled);
        CONSTANTS.DEBUG = isEnabled;
        Logger.info(\Debug mode: \\);
    },
    
    /**
     * Display results in UI
     * @param {object} results
     */
    displayResults(results) {
        UIState.setResults(results);
        const resultsSection = document.getElementById('resultsSection');
        const resultsList = document.getElementById('resultsList');
        
        if (!resultsSection || !resultsList) return;
        
        // Build results HTML
        let html = '<div>';
        for (const [key, value] of Object.entries(results)) {
            if (Array.isArray(value)) {
                html += \<div class='results-item'><strong>\:</strong> \ items</div>\;
            } else {
                html += \<div class='results-item'><strong>\:</strong> \</div>\;
            }
        }
        html += '</div>';
        
        resultsList.innerHTML = html;
        resultsSection.style.display = 'block';
        this.updateStatus('success', 'Analysis complete. Review results below.');
    },
    
    /**
     * Hide results section
     */
    hideResults() {
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
    },
    
    /**
     * Show loading indicator
     * @param {string} message
     */
    showLoading(message = 'Loading...') {
        UIState.setLoading(true);
        const loading = document.getElementById('loadingIndicator');
        if (loading) {
            loading.innerHTML = \<sp-icon class='spinner'></sp-icon><p>\</p>\;
            loading.style.display = 'flex';
        }
    },
    
    /**
     * Hide loading indicator
     */
    hideLoading() {
        UIState.setLoading(false);
        const loading = document.getElementById('loadingIndicator');
        if (loading) {
            loading.style.display = 'none';
        }
    },
    
    /**
     * Show error message
     * @param {string} message
     */
    showError(message) {
        UIState.setError(message);
        const errorDiv = document.getElementById('errorMessage');
        const errorText = document.getElementById('errorText');
        if (errorDiv && errorText) {
            errorText.textContent = message;
            errorDiv.style.display = 'flex';
        }
    },
    
    /**
     * Update status indicator
     * @param {string} status
     * @param {string} message
     */
    updateStatus(status, message) {
        UIState.setStatus(status, message);
        const statusText = document.getElementById('statusText');
        const statusIndicator = document.getElementById('statusIndicator');
        
        if (statusText) {
            statusText.textContent = message;
        }
        
        if (statusIndicator) {
            statusIndicator.className = \status-indicator status-\\;
        }
    },
    
    /**
     * Save settings to storage
     */
    saveSettings() {
        try {
            const settings = UIState.getSettings();
            localStorage.setItem('pluginSettings', JSON.stringify(settings));
            Logger.debug('Settings saved');
        } catch (e) {
            Logger.error('Failed to save settings', e);
        }
    },
    
    /**
     * Restore settings from storage
     */
    restoreSettings() {
        try {
            const saved = localStorage.getItem('pluginSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                for (const [key, value] of Object.entries(settings)) {
                    UIState.updateSetting(key, value);
                    const element = document.getElementById(\\Input\) || 
                                   document.getElementById(key);
                    if (element) {
                        element.value = value;
                    }
                }
                Logger.debug('Settings restored');
            }
        } catch (e) {
            Logger.error('Failed to restore settings', e);
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIController;
}
