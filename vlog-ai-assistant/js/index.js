/* index.js - Main plugin bootstrap */

/**
 * Plugin initialization
 * This runs when the panel loads in Premiere Pro
 */
function initializePlugin() {
    Logger.info('=== Premiere AI Assistant v' + CONSTANTS.VERSION + ' ===');
    Logger.debug('Current settings:', CONSTANTS);
    
    try {
        // Initialize UI controller
        UIController.init();
        
        // Check if Premiere Pro API is available via UXP module
        if (PremiereAPI.isAvailable()) {
            Logger.info('Connected to Premiere Pro via UXP module');
            UIController.updateStatus('ready', 'READY');
        } else {
            Logger.warn('premierepro module unavailable — load plugin inside Premiere Pro');
            UIController.updateStatus('error', 'NO PREMIERE CONTEXT');
        }
        
        // Save settings when they change
        document.addEventListener('change', function(e) {
            if (e.target.id === 'silenceThreshold' || 
                e.target.id === 'minSilenceDuration' ||
                e.target.id === 'confidenceThreshold' ||
                e.target.id === 'apiKeyInput') {
                UIController.saveSettings();
            }
        });
        
        Logger.info('Plugin initialized successfully');
    } catch (error) {
        Logger.error('Failed to initialize plugin', error);
        UIController.showError('Failed to initialize plugin: ' + error.message);
    }
}

/**
 * Run initialization when DOM is ready
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlugin);
} else {
    initializePlugin();
}

// Export for use as module (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initializePlugin };
}
