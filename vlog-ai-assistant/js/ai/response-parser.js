/* response-parser.js - Parse and validate Gemini API responses */

const ResponseParser = {
    /**
     * Parse silence detection response
     * @param {object} apiResponse
     * @returns {object|null}
     */
    parseSilenceResponse(apiResponse) {
        try {
            if (!apiResponse || !apiResponse.candidates || apiResponse.candidates.length === 0) {
                Logger.error('Invalid API response structure');
                return null;
            }
            
            const candidate = apiResponse.candidates[0];
            const text = candidate.content?.parts?.[0]?.text || '';
            
            // Extract JSON from response (may be wrapped in markdown code blocks)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                Logger.error('No JSON found in response');
                return null;
            }
            
            const parsed = JSON.parse(jsonMatch[0]);
            
            // Validate structure
            if (!Array.isArray(parsed.silenceSegments)) {
                Logger.error('Missing silenceSegments array');
                return null;
            }
            
            // Validate each segment
            const validated = parsed.silenceSegments.filter(segment => {
                return typeof segment.start === 'number' &&
                       typeof segment.end === 'number' &&
                       typeof segment.confidence === 'number' &&
                       segment.confidence >= 0 && segment.confidence <= 1;
            });
            
            Logger.info(\Parsed \ silence segments\);
            
            return {
                segments: validated,
                totalSilenceDuration: parsed.totalSilenceDuration || 0,
                estimatedTimeSavings: parsed.estimatedTimeSavings || '0%',
            };
        } catch (error) {
            Logger.error('Error parsing silence response', error);
            return null;
        }
    },
    
    /**
     * Parse B-roll detection response
     * @param {object} apiResponse
     * @returns {object|null}
     */
    parseBrollResponse(apiResponse) {
        try {
            if (!apiResponse || !apiResponse.candidates || apiResponse.candidates.length === 0) {
                Logger.error('Invalid API response structure');
                return null;
            }
            
            const candidate = apiResponse.candidates[0];
            const text = candidate.content?.parts?.[0]?.text || '';
            
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                Logger.error('No JSON found in response');
                return null;
            }
            
            const parsed = JSON.parse(jsonMatch[0]);
            
            if (!Array.isArray(parsed.opportunities)) {
                Logger.error('Missing opportunities array');
                return null;
            }
            
            // Validate each opportunity
            const validated = parsed.opportunities.filter(opp => {
                return typeof opp.timestamp === 'number' &&
                       opp.suggestion &&
                       typeof opp.confidence === 'number' &&
                       opp.confidence >= 0 && opp.confidence <= 1;
            });
            
            Logger.info(\Parsed \ B-roll opportunities\);
            
            return {
                opportunities: validated,
                totalOpportunities: validated.length,
            };
        } catch (error) {
            Logger.error('Error parsing B-roll response', error);
            return null;
        }
    },
    
    /**
     * Parse caption generation response
     * @param {object} apiResponse
     * @returns {object|null}
     */
    parseCaptionResponse(apiResponse) {
        try {
            if (!apiResponse || !apiResponse.candidates || apiResponse.candidates.length === 0) {
                Logger.error('Invalid API response structure');
                return null;
            }
            
            const candidate = apiResponse.candidates[0];
            const text = candidate.content?.parts?.[0]?.text || '';
            
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                Logger.error('No JSON found in response');
                return null;
            }
            
            const parsed = JSON.parse(jsonMatch[0]);
            
            if (!Array.isArray(parsed.captions)) {
                Logger.error('Missing captions array');
                return null;
            }
            
            // Validate each caption
            const validated = parsed.captions.filter(cap => {
                return typeof cap.timestamp === 'number' &&
                       typeof cap.duration === 'number' &&
                       cap.text && typeof cap.text === 'string';
            });
            
            Logger.info(\Parsed \ captions\);
            
            return {
                captions: validated,
                totalCaptions: validated.length,
            };
        } catch (error) {
            Logger.error('Error parsing caption response', error);
            return null;
        }
    },
    
    /**
     * Check if response indicates an API error
     * @param {object} apiResponse
     * @returns {string|null} Error message if error exists
     */
    getErrorMessage(apiResponse) {
        if (apiResponse?.error) {
            return apiResponse.error.message || 'Unknown API error';
        }
        if (!apiResponse?.candidates) {
            return 'Invalid API response format';
        }
        return null;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResponseParser;
}
