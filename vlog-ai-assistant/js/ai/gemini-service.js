/* ai-service.js (loaded as gemini-service.js)
 * Multi-provider AI client — supports Gemini, OpenAI, Anthropic, Ollama.
 * All methods normalize responses to { text, raw } before returning.
 */

const PROVIDERS = {
    gemini: {
        label:    'Google Gemini',
        url:      function(model, key) { return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key; },
        headers:  function()           { return { 'Content-Type': 'application/json' }; },
        body:     function(model, systemPrompt, userPrompt) {
            return JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: userPrompt }] }],
            });
        },
        extract:  function(data) {
            try { return data.candidates[0].content.parts[0].text; } catch (_) { return null; }
        },
        defaultModel: 'gemini-2.0-flash',
        keyHint:  'Get a free key at aistudio.google.com',
        keyPlaceholder: 'AIzaSy…',
    },
    openai: {
        label:    'OpenAI (ChatGPT)',
        url:      function(model)      { return 'https://api.openai.com/v1/chat/completions'; },
        headers:  function(key)        { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }; },
        body:     function(model, systemPrompt, userPrompt) {
            return JSON.stringify({
                model:      model,
                messages:   [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                max_tokens: 4096,
            });
        },
        extract:  function(data) {
            try { return data.choices[0].message.content; } catch (_) { return null; }
        },
        defaultModel: 'gpt-4o-mini',
        keyHint:  'Get a key at platform.openai.com',
        keyPlaceholder: 'sk-…',
    },
    anthropic: {
        label:    'Anthropic (Claude)',
        url:      function(model)      { return 'https://api.anthropic.com/v1/messages'; },
        headers:  function(key)        { return { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }; },
        body:     function(model, systemPrompt, userPrompt) {
            return JSON.stringify({
                model:      model,
                max_tokens: 4096,
                system:     systemPrompt,
                messages:   [{ role: 'user', content: userPrompt }],
            });
        },
        extract:  function(data) {
            try { return data.content[0].text; } catch (_) { return null; }
        },
        defaultModel: 'claude-haiku-4-5-20251001',
        keyHint:  'Get a key at console.anthropic.com',
        keyPlaceholder: 'sk-ant-…',
    },
    ollama: {
        label:    'Ollama (local / free)',
        url:      function(model)      { return (CONSTANTS.OLLAMA_URL || 'http://localhost:11434') + '/api/generate'; },
        headers:  function()           { return { 'Content-Type': 'application/json' }; },
        body:     function(model, systemPrompt, userPrompt) {
            return JSON.stringify({ model: model, system: systemPrompt, prompt: userPrompt, stream: false });
        },
        extract:  function(data) {
            try { return data.response; } catch (_) { return null; }
        },
        defaultModel: 'llama3.2',
        keyHint:  'No API key needed — runs on your machine (ollama.com)',
        keyPlaceholder: '(not required)',
    },
    'openai-compatible': {
        label:    'OpenAI-compatible (Groq, LM Studio, etc.)',
        url:      function(model)      { return (CONSTANTS.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/$/, '') + '/chat/completions'; },
        headers:  function(key)        { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (key || 'none') }; },
        body:     function(model, systemPrompt, userPrompt) {
            return JSON.stringify({ model: model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 4096 });
        },
        extract:  function(data) {
            try { return data.choices[0].message.content; } catch (_) { return null; }
        },
        defaultModel: 'llama3.2',
        keyHint:  'API key for your endpoint (optional for local)',
        keyPlaceholder: 'sk-… or leave blank',
    },
};

const AIService = {
    apiKey:   '',
    provider: 'gemini',
    model:    '',
    baseUrl:  '',

    initialize: function(keyOrOpts, provider) {
        if (keyOrOpts && typeof keyOrOpts === 'object') {
            this.apiKey   = keyOrOpts.apiKey   || this.apiKey   || '';
            this.provider = keyOrOpts.provider || this.provider || 'gemini';
            this.model    = keyOrOpts.model    || '';
            this.baseUrl  = keyOrOpts.baseUrl  || this.baseUrl  || '';
        } else {
            this.apiKey   = keyOrOpts || this.apiKey;
            this.provider = provider  || this.provider || 'gemini';
        }
        var cfg = PROVIDERS[this.provider] || PROVIDERS.gemini;
        if (!this.model) this.model = cfg.defaultModel;
        // Sync base URL into CONSTANTS so provider URL functions can read it
        if (this.baseUrl) CONSTANTS.OLLAMA_URL = this.baseUrl;
        Logger.debug('AIService initialized: provider=' + this.provider + ' model=' + this.model);
    },

    getProviderConfig() {
        return PROVIDERS[this.provider] || PROVIDERS.gemini;
    },

    async sendRequest(userPrompt, systemPrompt, retryCount) {
        retryCount = retryCount || 0;
        var cfg = this.getProviderConfig();
        var model = this.model || cfg.defaultModel;

        if (this.provider !== 'ollama' && !this.apiKey) {
            throw new Error('API key not configured. Add your key in the Config tab.');
        }

        var url     = cfg.url(model, this.apiKey);
        var headers = cfg.headers(this.apiKey);
        var body    = cfg.body(model, systemPrompt || PromptTemplates.getSystemInstruction(), userPrompt);

        Logger.info('AIService request → ' + this.provider + ' / ' + model + ' (attempt ' + (retryCount + 1) + ')');

        var controller = new AbortController();
        var timeoutId  = setTimeout(function() { controller.abort(); }, CONSTANTS.API_TIMEOUT);

        try {
            var response = await fetch(url, {
                method: 'POST', headers: headers, body: body, signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                var errBody = '';
                try { errBody = await response.text(); } catch (_) {}
                var httpErr = new Error('HTTP ' + response.status + ': ' + response.statusText + (errBody ? ' — ' + errBody.slice(0, 200) : ''));
                httpErr.status = response.status;
                throw httpErr;
            }

            var data = await response.json();
            var text = cfg.extract(data);

            if (!text) {
                Logger.warn('AIService: could not extract text from response, raw: ' + JSON.stringify(data).slice(0, 300));
                throw new Error('Empty response from AI provider');
            }

            Logger.info('AIService: response received (' + text.length + ' chars)');
            // Return a normalised wrapper so ResponseParser can read .text
            return { text: text, raw: data };

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('Request timed out after ' + (CONSTANTS.API_TIMEOUT / 1000) + 's');
            }

            // Retry on network errors (no HTTP status), not on 4xx auth/quota errors
            if (retryCount < CONSTANTS.MAX_RETRIES && !error.status) {
                var delay = Math.pow(2, retryCount) * CONSTANTS.RETRY_DELAY;
                Logger.warn('Retry ' + (retryCount + 1) + '/' + CONSTANTS.MAX_RETRIES + ' in ' + delay + 'ms');
                await new Promise(function(r) { setTimeout(r, delay); });
                return this.sendRequest(userPrompt, systemPrompt, retryCount + 1);
            }

            Logger.error('AIService request failed', error);
            throw error;
        }
    },

    async analyzeSilence(projectMetadata, threshold, minDuration) {
        Logger.info('Requesting silence analysis from ' + this.provider + '...');
        var prompt = PromptTemplates.getSilenceDetectionPrompt(projectMetadata, threshold, minDuration);
        return this.sendRequest(prompt);
    },

    async detectBroll(projectMetadata, confidenceThreshold) {
        Logger.info('Requesting B-roll detection from ' + this.provider + '...');
        var prompt = PromptTemplates.getBrollDetectionPrompt(projectMetadata, confidenceThreshold);
        return this.sendRequest(prompt);
    },

    async analyzeSequence(summary) {
        Logger.info('Requesting FCPXML sequence analysis from ' + this.provider + '...');
        var systemPrompt = 'You are Ambar, a professional vlog editor. Analyze video sequences and return edit decisions as valid JSON only. No explanations outside the JSON block.';
        var prompt = PromptTemplates.getFcpxmlAnalysisPrompt(summary);
        return this.sendRequest(prompt, systemPrompt);
    },

    async generateCaptions(projectMetadata) {
        Logger.info('Requesting caption generation from ' + this.provider + '...');
        var prompt = PromptTemplates.getCaptionGenerationPrompt(projectMetadata);
        return this.sendRequest(prompt);
    },
};

// Keep GeminiService as an alias so any leftover references don't break
var GeminiService = AIService;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIService;
}
