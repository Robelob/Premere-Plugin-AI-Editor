/* gemini-service.js - Gemini API client with retry and timeout */

const GeminiService = {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',

    initialize(key) {
        this.apiKey = key;
        Logger.debug('Gemini service initialized');
    },

    /**
     * Send a request to the Gemini API with retry and AbortController-based timeout.
     * @param {string} model
     * @param {object} requestBody
     * @param {number} retryCount
     * @returns {Promise<object>}
     */
    async sendRequest(model, requestBody, retryCount = 0) {
        if (!this.apiKey) throw new Error('API key not configured');

        const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;
        Logger.debug(`Sending request to Gemini (attempt ${retryCount + 1})...`);

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), CONSTANTS.API_TIMEOUT);

        try {
            const response = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(requestBody),
                signal:  controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const err = new Error(`API error: ${response.status} ${response.statusText}`);
                err.status = response.status;
                throw err;
            }

            const data = await response.json();
            Logger.debug('API response received');
            return data;

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                const timeoutErr = new Error('Request timed out after ' + (CONSTANTS.API_TIMEOUT / 1000) + 's');
                timeoutErr.message = 'timeout';
                throw timeoutErr;
            }

            if (retryCount < CONSTANTS.MAX_RETRIES && !error.status) {
                const delay = Math.pow(2, retryCount) * CONSTANTS.RETRY_DELAY;
                Logger.warn(`Retry ${retryCount + 1}/${CONSTANTS.MAX_RETRIES} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.sendRequest(model, requestBody, retryCount + 1);
            }

            Logger.error('Gemini request failed', error);
            throw error;
        }
    },

    async analyzeSilence(projectMetadata, threshold, minDuration) {
        Logger.info('Requesting silence analysis from Gemini...');
        const prompt = PromptTemplates.getSilenceDetectionPrompt(projectMetadata, threshold, minDuration);
        const response = await this.sendRequest('gemini-2.0-flash', {
            system_instruction: { parts: [{ text: PromptTemplates.getSystemInstruction() }] },
            contents: [{ parts: [{ text: prompt }] }],
        });
        return response;
    },

    async detectBroll(projectMetadata, confidenceThreshold) {
        Logger.info('Requesting B-roll detection from Gemini...');
        const prompt = PromptTemplates.getBrollDetectionPrompt(projectMetadata, confidenceThreshold);
        const response = await this.sendRequest('gemini-2.0-flash', {
            system_instruction: { parts: [{ text: PromptTemplates.getSystemInstruction() }] },
            contents: [{ parts: [{ text: prompt }] }],
        });
        return response;
    },

    async generateCaptions(projectMetadata) {
        Logger.info('Requesting caption generation from Gemini...');
        const prompt = PromptTemplates.getCaptionGenerationPrompt(projectMetadata);
        const response = await this.sendRequest('gemini-2.0-flash', {
            system_instruction: { parts: [{ text: PromptTemplates.getSystemInstruction() }] },
            contents: [{ parts: [{ text: prompt }] }],
        });
        return response;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeminiService;
}
