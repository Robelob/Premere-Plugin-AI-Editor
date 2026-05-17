/* ai-service.js - Universal AI provider client
 *
 * Supported providers:
 *   'ollama'           - Ollama local server (http://localhost:11434) — no API key needed
 *   'openai-compatible' - Any OpenAI-format endpoint (Groq, Mistral, OpenRouter, LM Studio, etc.)
 *   'gemini'           - Google Gemini
 *   'openai'           - OpenAI GPT
 *   'anthropic'        - Anthropic Claude
 *
 * All providers return a normalized { text: string } from sendPrompt().
 */

const AIService = {
    provider: 'ollama',
    apiKey:   '',
    model:    '',
    baseUrl:  '',

    initialize(config) {
        this.provider = config.provider || 'ollama';
        this.apiKey   = config.apiKey   || '';
        this.model    = config.model    || '';
        this.baseUrl  = config.baseUrl  || '';
        Logger.debug('AI service: provider=' + this.provider + ' model=' + this._model());
    },

    _isLocal() {
        return this.provider === 'ollama';
    },

    _defaultModel() {
        var defaults = {
            'ollama':            'llama3.2',
            'gemini':            'gemini-2.0-flash',
            'openai':            'gpt-4o-mini',
            'anthropic':         'claude-haiku-4-5-20251001',
            'openai-compatible': 'llama3.2',
        };
        return defaults[this.provider] || 'llama3.2';
    },

    _model() {
        var m = this.model || '';
        if (!m) return this._defaultModel();
        // Reject model names that clearly belong to a different provider (cross-contamination from localStorage)
        if (this.provider === 'gemini'    && !m.startsWith('gemini-'))  return this._defaultModel();
        if (this.provider === 'anthropic' && !m.startsWith('claude-'))  return this._defaultModel();
        return m;
    },

    _baseUrl() {
        if (this.provider === 'openai')  return 'https://api.openai.com/v1';
        if (this.provider === 'ollama')  return this.baseUrl || 'http://localhost:11434/v1';
        return this.baseUrl || 'http://localhost:11434/v1';
    },

    // ── Public unified interface ──────────────────────────────────────
    // Always resolves to { text: string }

    async sendPrompt(systemPrompt, userPrompt) {
        // Ollama and openai-compatible endpoints work without a key (e.g. LM Studio)
        var noKeyOk = this.provider === 'ollama' || this.provider === 'openai-compatible';
        if (!this.apiKey && !noKeyOk) throw new Error('API key not configured');
        var p = this.provider;
        if (p === 'gemini')             return await this._sendGemini(systemPrompt, userPrompt);
        if (p === 'anthropic')          return await this._sendAnthropic(systemPrompt, userPrompt);
        // ollama + openai + openai-compatible all use the same OpenAI chat format
        return await this._sendOpenAI(systemPrompt, userPrompt, this._baseUrl());
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
        // Ollama and some local servers accept any bearer value (or none)
        var authHeader = this.apiKey ? ('Bearer ' + this.apiKey) : 'Bearer ollama';
        var data = await this._fetch(baseUrl + '/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': authHeader,
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
        // Local inference (Ollama, LM Studio) needs more time than cloud APIs
        var isLocal = this.provider === 'ollama' || this.provider === 'openai-compatible';
        var timeout  = isLocal ? 180000 : CONSTANTS.API_TIMEOUT; // 3 min local, 30s cloud
        var timeoutId  = setTimeout(function() { controller.abort(); }, timeout);
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
                var te = new Error('Request timed out after ' + Math.round(timeout / 1000) + 's — is ' + (isLocal ? 'Ollama' : 'the API') + ' running?');
                te.isTimeout = true;
                throw te;
            }
            if (retryCount < CONSTANTS.MAX_RETRIES && !error.status && !error.isTimeout) {
                var delay = Math.pow(2, retryCount) * CONSTANTS.RETRY_DELAY;
                Logger.warn('AI retry ' + (retryCount + 1) + '/' + CONSTANTS.MAX_RETRIES + ' in ' + delay + 'ms');
                await new Promise(function(r) { setTimeout(r, delay); });
                return self._fetch(url, options, retryCount + 1);
            }
            Logger.error('AI request failed', error);
            throw error;
        }
    },

    // ── Audio transcription (Approach B from TRANSCRIPT_GUIDE) ───────────────

    // Send an audio/video file to the configured AI for word-level transcription.
    // Returns { success, words: [{ word, startTime, endTime, confidence }] }
    // or      { success: false, error, sizeMB? (if FILE_TOO_LARGE) }
    async sendAudioFile(filePath) {
        var p = this.provider;
        if (p === 'gemini')   return await this._transcribeWithGemini(filePath);
        if (p === 'openai' || p === 'openai-compatible') return await this._transcribeWithWhisperAPI(filePath);
        return { success: false, error: 'Audio transcription requires Gemini or an OpenAI-compatible provider (e.g. Groq). Current provider: ' + p };
    },

    // Groq / OpenAI Whisper via multipart form upload
    async _transcribeWithWhisperAPI(filePath) {
        var uxp = require('uxp');
        var fs  = uxp.storage.localFileSystem;
        var url = 'file:///' + filePath.replace(/\\/g, '/');

        var buffer;
        try {
            var entry = await fs.getEntryWithUrl(url);
            buffer = await entry.read({ format: uxp.storage.formats.binary });
        } catch (e) {
            return { success: false, error: 'Could not read file: ' + e.message };
        }

        var MAX_BYTES = 25 * 1024 * 1024; // 25MB Groq/OpenAI limit
        if (buffer.byteLength > MAX_BYTES) {
            return { success: false, error: 'FILE_TOO_LARGE', sizeMB: Math.round(buffer.byteLength / 1024 / 1024) };
        }

        var filename = filePath.split(/[\\/]/).pop();
        var ext      = filename.split('.').pop().toLowerCase();
        var mimeTypes = {
            'mp4': 'video/mp4', 'mov': 'video/quicktime', 'avi': 'video/avi',
            'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4',
            'aac': 'audio/aac', 'mxf': 'video/mxf', 'webm': 'video/webm',
        };
        var mimeType = mimeTypes[ext] || 'video/mp4';

        var blob     = new Blob([buffer], { type: mimeType });
        var formData = new FormData();
        formData.append('file',    blob, filename);
        formData.append('model',   this.model || 'whisper-large-v3-turbo');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'word');

        try {
            var res = await fetch(this._baseUrl() + '/audio/transcriptions', {
                method:  'POST',
                headers: { 'Authorization': 'Bearer ' + this.apiKey },
                body:    formData,
            });
            if (!res.ok) {
                var errText = await res.text();
                return { success: false, error: 'Whisper API ' + res.status + ': ' + errText };
            }
            var data = await res.json();
            // Groq/Whisper returns { words: [{ word, start, end }] }
            var words = (data.words || []).map(function(w) {
                return { word: w.word, startTime: w.start, endTime: w.end, confidence: 1.0 };
            });
            if (!words.length) return { success: false, error: 'No words returned — does the file have audio?' };
            return { success: true, words: words, duration: data.duration };
        } catch (e) {
            return { success: false, error: 'Transcription request failed: ' + e.message };
        }
    },

    // Gemini inline audio (base64-encoded, 20MB limit)
    async _transcribeWithGemini(filePath) {
        var uxp = require('uxp');
        var fs  = uxp.storage.localFileSystem;
        var url = 'file:///' + filePath.replace(/\\/g, '/');

        var buffer;
        try {
            var entry = await fs.getEntryWithUrl(url);
            buffer = await entry.read({ format: uxp.storage.formats.binary });
        } catch (e) {
            return { success: false, error: 'Could not read file: ' + e.message };
        }

        var MAX_BYTES = 20 * 1024 * 1024; // 20MB Gemini inline limit
        if (buffer.byteLength > MAX_BYTES) {
            return { success: false, error: 'FILE_TOO_LARGE', sizeMB: Math.round(buffer.byteLength / 1024 / 1024) };
        }

        var uint8 = new Uint8Array(buffer);
        var binary = '';
        var CHUNK = 8192;
        for (var i = 0; i < uint8.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
        }
        var base64Audio = btoa(binary);

        var ext = filePath.split('.').pop().toLowerCase();
        var mimeMap = { 'mp4': 'video/mp4', 'mov': 'video/quicktime', 'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'mxf': 'video/mxf' };
        var mimeType = mimeMap[ext] || 'video/mp4';

        var systemPrompt = 'You are a precise audio transcription engine. Return ONLY JSON: {"words":[{"word":"Hello","startTime":0.000,"endTime":0.320},...],"duration":120.5}. No markdown.';
        var apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + this.apiKey;

        try {
            var res = await fetch(apiUrl, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [
                        { text: systemPrompt },
                        { inline_data: { mime_type: mimeType, data: base64Audio } },
                    ]}],
                    generationConfig: { temperature: 0, response_mime_type: 'application/json' },
                }),
            });
            var data = await res.json();
            var text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
            if (!text) return { success: false, error: 'Empty response from Gemini audio' };
            var parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
            return { success: true, words: parsed.words, duration: parsed.duration };
        } catch (e) {
            return { success: false, error: 'Gemini audio error: ' + e.message };
        }
    },

    // ── Analysis methods (called by UIController) ─────────────────────

    async analyzeSequence(summary) {
        Logger.info('FCPXML analysis via ' + this.provider + '/' + this._model());
        return await this.sendPrompt(
            'You are Ambar, a professional vlog editor. Analyze video sequences and return edit decisions as valid JSON only. No explanations outside the JSON block.',
            PromptTemplates.getFcpxmlAnalysisPrompt(summary)
        );
    },

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

    // ── Two-pass clip classifier (Pass 2) ─────────────────────────────
    // Takes descriptions produced by VisionService.describeFrame() for all clips
    // and classifies them in ONE text LLM call — much faster than N vision calls.
    //
    // descriptions: [{ filename, description }, ...]
    // Returns:      [{ filename, category, confidence }, ...]
    async classifyAllClips(descriptions) {
        const clipList = descriptions
            .map(function(d, i) {
                return '[' + (i + 1) + '] filename: "' + d.filename + '" — "' + d.description + '"';
            })
            .join('\n');

        const prompt =
            'Classify these video clips. Pick exactly one category per clip.\n' +
            'Use both the visual description AND the filename as clues.\n' +
            'Filenames starting with "DJI_" are typically drone/aerial shots.\n' +
            'Filenames starting with "ZVE" are Sony camera clips (could be any type).\n' +
            'If a description says "description failed" or "frame extraction failed", classify by filename only.\n\n' +
            'Categories (definitions):\n' +
            '  talking-head    — person speaking directly to camera, face visible in frame\n' +
            '  aerial-drone    — shot from above / bird\'s eye / high-altitude drone perspective\n' +
            '  indoor-broll    — interior spaces: temples, markets, caves, restaurants, hotels\n' +
            '  outdoor-broll   — street level, parks, buildings from outside, crowds\n' +
            '  landscape       — wide nature shots: sea, mountains, sky, forest, coastline\n' +
            '  product-closeup — object or product fills frame, macro or detail shot\n' +
            '  screen-recording — computer/phone screen with UI visible\n' +
            '  other           — anything that does not fit the above\n\n' +
            'Clips to classify:\n' + clipList + '\n\n' +
            'Return ONLY valid JSON — no markdown, no explanation:\n' +
            '{"classifications":[{"filename":"...","category":"...","confidence":0.0}]}';

        Logger.info('[AIService] classifyAllClips: ' + descriptions.length + ' clip(s) via ' + this.provider + '/' + this._model());
        try {
            const response = await this.sendPrompt(
                'You are a video clip classifier. Return only valid JSON, no explanation.',
                prompt
            );
            const clean  = (response.text || '').replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(clean);
            if (!Array.isArray(parsed.classifications)) throw new Error('no classifications array');
            Logger.info('[AIService] classifyAllClips: parsed ' + parsed.classifications.length + ' result(s)');
            return parsed.classifications;
        } catch (e) {
            Logger.error('[AIService] classifyAllClips parse failed: ' + e.message);
            return descriptions.map(function(d) {
                return { filename: d.filename, category: 'other', confidence: 0 };
            });
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIService;
}
