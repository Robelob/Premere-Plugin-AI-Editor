/* ai-service.js - Universal AI provider client
 *
 * Supported providers:
 *   'gemini'           - Google Gemini (generativelanguage.googleapis.com)
 *   'openai'           - OpenAI GPT (api.openai.com)
 *   'anthropic'        - Anthropic Claude (api.anthropic.com)
 *   'openai-compatible' - Any OpenAI-format endpoint (Groq, Mistral, OpenRouter, etc.)
 *
 * All providers return a normalized { text: string } from sendPrompt().
 */

const AIService = {
    provider: 'gemini',
    apiKey:   '',
    model:    '',
    baseUrl:  '',

    initialize(config) {
        this.provider = config.provider || 'gemini';
        this.apiKey   = config.apiKey   || '';
        this.model    = config.model    || '';
        this.baseUrl  = config.baseUrl  || '';
        Logger.debug('AI service: provider=' + this.provider + ' model=' + this._model());
    },

    _defaultModel() {
        var defaults = {
            'gemini':            'gemini-2.0-flash',
            'openai':            'gpt-4o-mini',
            'anthropic':         'claude-haiku-4-5-20251001',
            'openai-compatible': 'llama-3.3-70b-versatile',
        };
        return defaults[this.provider] || 'gpt-4o-mini';
    },

    _model() { return this.model || this._defaultModel(); },

    // ── Public unified interface ──────────────────────────────────────
    // Always resolves to { text: string }

    async sendPrompt(systemPrompt, userPrompt) {
        if (!this.apiKey) throw new Error('API key not configured');
        var p = this.provider;
        if (p === 'gemini')             return await this._sendGemini(systemPrompt, userPrompt);
        if (p === 'openai')             return await this._sendOpenAI(systemPrompt, userPrompt, 'https://api.openai.com/v1');
        if (p === 'anthropic')          return await this._sendAnthropic(systemPrompt, userPrompt);
        if (p === 'openai-compatible')  return await this._sendOpenAI(systemPrompt, userPrompt, this.baseUrl || 'https://api.openai.com/v1');
        throw new Error('Unknown provider: ' + p);
    },

    // ── Provider implementations ──────────────────────────────────────

    async _sendGemini(system, user) {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  this._model() + ':generateContent?key=' + this.apiKey;
        var data = await this._fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                system_instruction: { parts: [{ text: system }] },
                contents:           [{ parts: [{ text: user   }] }],
            }),
        });
        var text = '';
        try { text = data.candidates[0].content.parts[0].text; } catch (_) {}
        return { text: text };
    },

    async _sendOpenAI(system, user, baseUrl) {
        var data = await this._fetch(baseUrl + '/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + this.apiKey,
            },
            body: JSON.stringify({
                model:       this._model(),
                messages:    [
                    { role: 'system', content: system },
                    { role: 'user',   content: user   },
                ],
                temperature: 0.3,
            }),
        });
        var text = '';
        try { text = data.choices[0].message.content; } catch (_) {}
        return { text: text };
    },

    async _sendAnthropic(system, user) {
        var data = await this._fetch('https://api.anthropic.com/v1/messages', {
            method:  'POST',
            headers: {
                'Content-Type':                          'application/json',
                'x-api-key':                             this.apiKey,
                'anthropic-version':                     '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model:      this._model(),
                max_tokens: 4096,
                system:     system,
                messages:   [{ role: 'user', content: user }],
            }),
        });
        var text = '';
        try { text = data.content[0].text; } catch (_) {}
        return { text: text };
    },

    // ── HTTP layer with timeout + retry ───────────────────────────────

    async _fetch(url, options, retryCount) {
        var self = this;
        retryCount = retryCount || 0;
        var controller = new AbortController();
        var timeoutId  = setTimeout(function() { controller.abort(); }, CONSTANTS.API_TIMEOUT);
        try {
            var res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
            clearTimeout(timeoutId);
            if (!res.ok) {
                var err = new Error('API error: ' + res.status + ' ' + res.statusText);
                err.status = res.status;
                throw err;
            }
            return await res.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                var te = new Error('timeout'); te.message = 'timeout'; throw te;
            }
            if (retryCount < CONSTANTS.MAX_RETRIES && !error.status) {
                var delay = Math.pow(2, retryCount) * CONSTANTS.RETRY_DELAY;
                Logger.warn('AI retry ' + (retryCount + 1) + '/' + CONSTANTS.MAX_RETRIES + ' in ' + delay + 'ms');
                await new Promise(function(r) { setTimeout(r, delay); });
                return self._fetch(url, options, retryCount + 1);
            }
            Logger.error('AI request failed', error);
            throw error;
        }
    },

    // ── Analysis methods (called by UIController) ─────────────────────

    async analyzeSilence(projectMetadata, threshold, minDuration) {
        Logger.info('Silence analysis via ' + this.provider + '/' + this._model());
        return await this.sendPrompt(
            PromptTemplates.getSystemInstruction(),
            PromptTemplates.getSilenceDetectionPrompt(projectMetadata, threshold, minDuration)
        );
    },

    async detectBroll(projectMetadata, confidenceThreshold) {
        Logger.info('B-roll detection via ' + this.provider + '/' + this._model());
        return await this.sendPrompt(
            PromptTemplates.getSystemInstruction(),
            PromptTemplates.getBrollDetectionPrompt(projectMetadata, confidenceThreshold)
        );
    },

    async generateCaptions(projectMetadata) {
        Logger.info('Caption generation via ' + this.provider + '/' + this._model());
        return await this.sendPrompt(
            PromptTemplates.getSystemInstruction(),
            PromptTemplates.getCaptionGenerationPrompt(projectMetadata)
        );
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIService;
}
