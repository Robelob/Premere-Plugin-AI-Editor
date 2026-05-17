/* vision-service.js — Layer 2b: Ollama vision model integration
 * Sends base64-encoded JPEG frames to Ollama vision models (no data: URI prefix).
 * Pass 1 (describe): llava receives 3 frames (start/mid/end) in one call for richer context.
 * Pass 2 (classify): AIService.classifyAllClips() sends all descriptions to the text LLM at once.
 */

const VisionService = {

    // base64Frames: a single base64 string OR an array of up to 3 base64 strings.
    // When an array is passed (beginning/middle/end frames), all are sent in one Ollama call.
    async describeFrame(base64Frames, model) {
        const frames = Array.isArray(base64Frames)
            ? base64Frames.filter(Boolean)
            : (base64Frames ? [base64Frames] : []);
        if (!frames.length) return { success: false, description: '', error: 'No image data (frame extraction failed)' };
        model = model || CONSTANTS.VISION_MODEL || 'llava:7b';
        const frameLabel = frames.length > 1
            ? 'You are seeing ' + frames.length + ' frames sampled from the beginning, middle, and end of a video clip. '
            : '';
        const prompt = frameLabel +
            'Describe what type of video content this clip shows in one sentence. ' +
            'Include: camera angle (ground level / aerial / close-up / wide shot), ' +
            'location type (indoors / outdoors / studio), ' +
            'main subject (person talking to camera, building exterior, landscape, product, screen recording), ' +
            'and any distinctive visual cues (temple, market, drone view, ocean, forest, talking head, etc.). ' +
            'Be specific and concise.';
        try {
            const res = await this._generate(model, prompt, frames, false);
            if (!res.success) return { success: false, description: '', error: res.error };
            return { success: true, description: res.text, model };
        } catch (e) {
            Logger.error('[VisionService] describeFrame: ' + e.message);
            return { success: false, description: '', error: e.message };
        }
    },

    async suggestBrollForFrame(base64ImageData, speakerText, model) {
        if (!base64ImageData) return { success: false, suggestions: [] };
        model = model || CONSTANTS.VISION_MODEL || 'llava:7b';
        const prompt = 'The speaker is saying: \'' + speakerText + '\'.\nLooking at this video frame, suggest 3 specific B-roll shots that would enhance this moment. Return ONLY JSON: { "suggestions": ["...", "...", "..."] }';
        try {
            const res = await this._generate(model, prompt, base64ImageData, true);
            if (!res.success) return { success: false, suggestions: [] };
            const parsed = res.text;
            return {
                success: true,
                suggestions: Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [],
            };
        } catch (e) {
            Logger.error('[VisionService] suggestBrollForFrame: ' + e.message);
            return { success: false, suggestions: [] };
        }
    },

    async classifyClip(base64ImageData, model) {
        if (!base64ImageData) return { success: false, category: 'other', confidence: 0, tags: [] };
        model = model || CONSTANTS.VISION_MODEL || 'llava:7b';
        const prompt = 'Classify this video clip into ONE category. Return ONLY JSON: { "category": "talking-head" | "broll-outdoor" | "broll-indoor" | "product-closeup" | "screen-recording" | "other", "confidence": 0.0-1.0, "tags": ["tag1", "tag2"] }';
        try {
            const res = await this._generate(model, prompt, base64ImageData, true);
            if (!res.success) return { success: false, category: 'other', confidence: 0, tags: [] };
            const parsed = res.text;
            return {
                success: true,
                category:   (parsed && parsed.category)    || 'other',
                confidence: (parsed && typeof parsed.confidence === 'number') ? parsed.confidence : 0,
                tags:       (parsed && Array.isArray(parsed.tags)) ? parsed.tags : [],
            };
        } catch (e) {
            Logger.error('[VisionService] classifyClip: ' + e.message);
            return { success: false, category: 'other', confidence: 0, tags: [] };
        }
    },

    async _checkModelAvailable(model) {
        try {
            const res  = await fetch('http://localhost:11434/api/tags');
            const data = await res.json();
            const names = (data.models || []).map(function(m) { return m.name; });
            const ok = names.some(function(n) { return n === model || n.startsWith(model + ':'); });
            if (ok) return { available: true };
            return { available: false, suggestion: 'Run: ollama pull ' + model };
        } catch (e) {
            return { available: false, suggestion: 'Ollama not reachable at localhost:11434' };
        }
    },

    // images: a single base64 string or an array of base64 strings.
    async _generate(model, prompt, images, jsonMode) {
        const imageArray = Array.isArray(images) ? images : [images];
        const body = {
            model:  model,
            prompt: prompt,
            images: imageArray,
            stream: false,
        };
        if (jsonMode) body.format = 'json';

        try {
            const res = await fetch('http://localhost:11434/api/generate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
            });
            if (!res.ok) {
                const errText = await res.text();
                Logger.error('[VisionService] Ollama ' + res.status + ': ' + errText);
                return { success: false, error: 'Ollama error ' + res.status };
            }
            const data = await res.json();
            const raw  = data.response || '';
            if (jsonMode) {
                let parsed = raw;
                try { parsed = JSON.parse(raw); } catch (_) { /* moondream sometimes returns valid JSON directly */ }
                return { success: true, text: parsed };
            }
            return { success: true, text: raw };
        } catch (e) {
            Logger.error('[VisionService] _generate: ' + e.message);
            return { success: false, error: e.message };
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VisionService;
}
