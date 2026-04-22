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
        
        // Check if Premiere context is available
        if (typeof app !== 'undefined' && app && app.project) {
            Logger.info('Connected to Adobe Premiere Pro');
            UIController.updateStatus('ready', 'Ready to analyze. Open a sequence to begin.');
        } else {
            Logger.warn('Premiere Pro context not available - running in limited mode');
            UIController.updateStatus('ready', 'Waiting for Premiere Pro context...');
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
