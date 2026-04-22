/* gemini-service.js - Gemini API client and request handler */

const GeminiService = {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    
    /**
     * Initialize with API key
     * @param {string} key - Gemini API key
     */
    initialize(key) {
        this.apiKey = key;
        Logger.debug('Gemini service initialized');
    },
    
    /**
     * Send request to Gemini API with retry logic
     * @param {string} model - Model name (e.g., 'gemini-2.0-flash')
     * @param {object} requestBody - Request payload
     * @param {number} retryCount - Current retry attempt
     * @returns {Promise<object>}
     */
    async sendRequest(model, requestBody, retryCount = 0) {
        try {
            if (!this.apiKey) {
                throw new Error('API key not configured');
            }
            
            const url = \\/\:generateContent?key=\\;
            
            Logger.debug(\Sending request to \...\);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                timeout: CONSTANTS.API_TIMEOUT,
            });
            
            if (!response.ok) {
                throw new Error(\API error: \ \\);
            }
            
            const data = await response.json();
            Logger.debug('API response received');
            return data;
        } catch (error) {
            if (retryCount < CONSTANTS.MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * CONSTANTS.RETRY_DELAY;
                Logger.warn(\Retry attempt \/\ after \ms\);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.sendRequest(model, requestBody, retryCount + 1);
            } else {
                Logger.error('Max retries exceeded', error);
                throw error;
            }
        }
    },
    
    /**
     * Analyze audio for silence detection
     * @param {object} projectMetadata
     * @param {number} threshold
     * @param {number} minDuration
     * @returns {Promise<object>}
     */
    async analyzeSilence(projectMetadata, threshold, minDuration) {
        try {
            Logger.info('Requesting silence analysis from Gemini...');
            
            const prompt = PromptTemplates.getSilenceDetectionPrompt(
                projectMetadata,
                threshold,
                minDuration
            );
            
            const requestBody = {
                contents: [{
                    parts: [{
                        text: prompt,
                    }],
                }],
            };
            
            const response = await this.sendRequest('gemini-2.0-flash', requestBody);
            return response;
        } catch (error) {
            Logger.error('Silence analysis failed', error);
            throw error;
        }
    },
    
    /**
     * Detect B-roll opportunities
     * @param {object} projectMetadata
     * @param {number} confidenceThreshold
     * @returns {Promise<object>}
     */
    async detectBroll(projectMetadata, confidenceThreshold) {
        try {
            Logger.info('Requesting B-roll detection from Gemini...');
            
            const prompt = PromptTemplates.getBrollDetectionPrompt(
                projectMetadata,
                confidenceThreshold
            );
            
            const requestBody = {
                contents: [{
                    parts: [{
                        text: prompt,
                    }],
                }],
            };
            
            const response = await this.sendRequest('gemini-2.0-flash', requestBody);
            return response;
        } catch (error) {
            Logger.error('B-roll detection failed', error);
            throw error;
        }
    },
    
    /**
     * Generate captions for content
     * @param {object} projectMetadata
     * @returns {Promise<object>}
     */
    async generateCaptions(projectMetadata) {
        try {
            Logger.info('Requesting caption generation from Gemini...');
            
            const prompt = PromptTemplates.getCaptionGenerationPrompt(projectMetadata);
            
            const requestBody = {
                contents: [{
                    parts: [{
                        text: prompt,
                    }],
                }],
            };
            
            const response = await this.sendRequest('gemini-2.0-flash', requestBody);
            return response;
        } catch (error) {
            Logger.error('Caption generation failed', error);
            throw error;
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeminiService;
}
