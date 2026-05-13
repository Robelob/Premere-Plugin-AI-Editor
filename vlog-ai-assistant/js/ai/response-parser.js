/* response-parser.js - Parse and validate AI responses
 * Expects { text: "...", raw: {...} } from AIService.
 * Extracts JSON from the text field regardless of provider.
 */

const ResponseParser = {

    _extractText(apiResponse) {
        if (!apiResponse) return null;
        // Normalized format from AIService
        if (typeof apiResponse.text === 'string' && apiResponse.text.length > 0) return apiResponse.text;
        // Legacy Gemini format (fallback)
        try {
            var c = apiResponse.candidates && apiResponse.candidates[0];
            return (c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text) || null;
        } catch (_) { return null; }
    },

    _parseJSON(text) {
        if (!text) return null;
        // Strip markdown code fences if present
        var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        var jsonStr = match ? match[1] : text;
        // Find first {...} block
        var objMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (!objMatch) { Logger.error('ResponseParser: no JSON object found in response'); return null; }
        try {
            return JSON.parse(objMatch[0]);
        } catch (e) {
            Logger.error('ResponseParser: JSON parse failed — ' + e.message);
            return null;
        }
    },

    parseSilenceResponse(apiResponse) {
        try {
            var text = this._extractText(apiResponse);
            if (!text) { Logger.error('parseSilenceResponse: no text in response'); return null; }
            var parsed = this._parseJSON(text);
            if (!parsed || !Array.isArray(parsed.silenceSegments)) {
                Logger.error('parseSilenceResponse: missing silenceSegments array');
                return null;
            }
            var validated = parsed.silenceSegments.filter(function(s) {
                return typeof s.start === 'number' && typeof s.end === 'number' &&
                       typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 1;
            });
            Logger.info('Parsed ' + validated.length + ' silence segments');
            return {
                segments: validated,
                totalSilenceDuration: parsed.totalSilenceDuration || 0,
                estimatedTimeSavings: parsed.estimatedTimeSavings || '0%',
            };
        } catch (e) {
            Logger.error('Error parsing silence response', e);
            return null;
        }
    },

    parseBrollResponse(apiResponse) {
        try {
            var text = this._extractText(apiResponse);
            if (!text) { Logger.error('parseBrollResponse: no text in response'); return null; }
            var parsed = this._parseJSON(text);
            if (!parsed || !Array.isArray(parsed.opportunities)) {
                Logger.error('parseBrollResponse: missing opportunities array');
                return null;
            }
            var validated = parsed.opportunities.filter(function(o) {
                return typeof o.timestamp === 'number' && o.suggestion &&
                       typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1;
            });
            Logger.info('Parsed ' + validated.length + ' B-roll opportunities');
            return { opportunities: validated, totalOpportunities: validated.length };
        } catch (e) {
            Logger.error('Error parsing B-roll response', e);
            return null;
        }
    },

    parseCaptionResponse(apiResponse) {
        try {
            var text = this._extractText(apiResponse);
            if (!text) { Logger.error('parseCaptionResponse: no text in response'); return null; }
            var parsed = this._parseJSON(text);
            if (!parsed || !Array.isArray(parsed.captions)) {
                Logger.error('parseCaptionResponse: missing captions array');
                return null;
            }
            var validated = parsed.captions.filter(function(c) {
                return typeof c.timestamp === 'number' && typeof c.duration === 'number' &&
                       c.text && typeof c.text === 'string';
            });
            Logger.info('Parsed ' + validated.length + ' captions');
            return { captions: validated, totalCaptions: validated.length };
        } catch (e) {
            Logger.error('Error parsing caption response', e);
            return null;
        }
    },

    parseEditDecisions: function(apiResponse) {
        try {
            var text = this._extractText(apiResponse);
            if (!text) { Logger.error('parseEditDecisions: no text in response'); return null; }
            var parsed = this._parseJSON(text);
            if (!parsed || !Array.isArray(parsed.decisions)) {
                Logger.error('parseEditDecisions: missing decisions array — raw: ' + (text || '').slice(0, 300));
                return null;
            }
            var validated = parsed.decisions.filter(function(d) {
                return (d.type === 'cut' || d.type === 'broll' || d.type === 'story') &&
                       typeof d.timelineOffset === 'number' &&
                       typeof d.confidence === 'number';
            });
            Logger.info('Parsed ' + validated.length + ' edit decisions');
            return {
                summary:   parsed.summary || '',
                decisions: validated,
                counts: {
                    cut:   validated.filter(function(d) { return d.type === 'cut';   }).length,
                    broll: validated.filter(function(d) { return d.type === 'broll'; }).length,
                    story: validated.filter(function(d) { return d.type === 'story'; }).length,
                }
            };
        } catch (e) {
            Logger.error('Error parsing edit decisions', e);
            return null;
        }
    },

    getErrorMessage(apiResponse) {
        if (apiResponse && apiResponse.error) return apiResponse.error.message || 'Unknown API error';
        if (!apiResponse) return 'No response received';
        return null;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResponseParser;
}
